/**
 * Bob's hook settings: what the pet writes into them, and how it takes it back out.
 *
 * Kept apart from the extension itself so the uninstall script, which runs under plain
 * node with no VS Code API around it, removes the hooks with exactly the same code that
 * installed them.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

// ---------------------------------------------------------------------------
// IBM Bob hook integration
//
// Bob runs a command for each of its documented hook events (SessionStart,
// UserPromptSubmit, PreToolUse, PostToolUse, Stop), configured in its own
// settings.json. That is the sanctioned way to observe agent activity: no Bob file is
// modified, no undocumented API is called, and the user opts in explicitly by running
// the connect command. The pet's state comes from those events and nothing else.
// ---------------------------------------------------------------------------

export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const;

/**
 * The pet follows IBM Bob's own agent. Other agents that may run inside the IDE are
 * deliberately not wired up: the pet should reflect what Bob is doing, not whatever
 * else happens to be running in a panel.
 */
export type HookTarget = { label: string; settings: string };
export const HOOK_TARGETS: HookTarget[] = [
  { label: 'IBM Bob agent (bob-code)', settings: join(homedir(), '.bob', 'settings', 'settings.json') }
];

export type HookEntry = { type: 'command'; command: string; timeout?: number; disabled?: boolean };
export type HookGroup = { matcher?: string; hooks: HookEntry[] };

/**
 * Builds the single command string Bob runs for every hook event.
 *
 * Bob invokes hooks with `exec`, which on Windows is `cmd.exe /d /s /c "<command>"`.
 * An earlier version pointed that at a generated `.cmd` shim; cmd refused to run it from
 * the extension host - `'"...\bob-pet-hook.cmd"' is not recognized` - even though the
 * file existed and PATHEXT contained `.CMD`. Chaining builtins with `&` needs no file
 * resolution at all, and builtins are demonstrably fine in that environment.
 *
 * `ELECTRON_RUN_AS_NODE` runs the companion's bundled Node without starting Chromium,
 * keeping each hook to tens of milliseconds.
 *
 * `ELECTRON_NO_ASAR` must be *cleared*: the extension host exports it, `exec` passes it
 * down, and with it set `app.asar` stops behaving as a directory, so requiring the hook
 * out of the archive fails at module load - before any error handling inside the hook
 * can run, making the failure invisible.
 *
 * stdout goes to nul so Bob can never receive output from us (it would be injected into
 * the model's context); stderr is captured to a single overwritten file so a failure is
 * diagnosable without the log growing without bound.
 */
export const HOOK_MARKER = 'BOB_PET_HOOK';
export const HOOK_TIMEOUT_S = 5;
export function hookCommand(target: { exe: string; hookScript: string }): string {
  const errorLog = join(process.env.APPDATA ?? homedir(), 'Bob Pet', 'hook-last-error.log');
  return [
    `set "${HOOK_MARKER}=1"`,
    'set "ELECTRON_RUN_AS_NODE=1"',
    'set "ELECTRON_NO_ASAR="',
    `"${target.exe}" "${target.hookScript}" 1>nul 2>"${errorLog}"`
  ].join(' & ');
}

export async function readAgentSettings(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const isOurs = (entry: HookEntry): boolean => entry.command.includes(HOOK_MARKER);

/** Returns the hooks block with our entries removed, leaving anyone else's intact. */
export function withoutPetHooks(hooks: Record<string, HookGroup[]>): Record<string, HookGroup[]> {
  const next: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = groups
      .map((group) => ({ ...group, hooks: group.hooks.filter((entry) => !isOurs(entry)) }))
      .filter((group) => group.hooks.length > 0);
    if (kept.length > 0) next[event] = kept;
  }
  return next;
}

/** Rewrites one agent's settings file, preserving every key that is not ours. */
export async function applyHooks(target: HookTarget, entry: HookEntry | undefined): Promise<void> {
  const settings = await readAgentSettings(target.settings);
  const hooks = withoutPetHooks((settings.hooks ?? {}) as Record<string, HookGroup[]>);
  if (entry) {
    // Every event is a quick, fire-and-forget report; none of them waits on a person.
    for (const event of HOOK_EVENTS) hooks[event] = [...(hooks[event] ?? []), { hooks: [entry] }];
  }
  const next: Record<string, unknown> = { ...settings };
  if (Object.keys(hooks).length > 0) next.hooks = hooks;
  else delete next.hooks;
  await mkdir(dirname(target.settings), { recursive: true });
  await writeFile(target.settings, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}


/** The pet's own hook commands currently installed in one agent's settings. */
export async function installedPetHooks(target: HookTarget): Promise<string[]> {
  const settings = await readAgentSettings(target.settings);
  const hooks = (settings.hooks ?? {}) as Record<string, HookGroup[]>;
  const commands = new Set<string>();
  for (const groups of Object.values(hooks)) {
    for (const group of groups) for (const entry of group.hooks) if (isOurs(entry)) commands.add(entry.command);
  }
  return [...commands];
}
