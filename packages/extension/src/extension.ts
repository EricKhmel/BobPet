import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { Socket } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { exec, spawn, type ChildProcess } from 'node:child_process';
import { type PetState } from '@bob-pet/shared';

let companion: ChildProcess | undefined;
let secret: string | undefined;
let port: number | undefined;
let status: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let persistentClientSocket: Socket | undefined;

function getLogger(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Bob Pet');
  }
  return outputChannel;
}

function log(msg: string): void {
  getLogger().appendLine(`[${new Date().toISOString()}] ${msg}`);
}

function executable(): string {
  return vscode.workspace.getConfiguration('bobPet').get<string>('companionPath', '');
}

/** How long "Bob Pet stopped" stays up before the button offers to start it again. */
const STOPPED_NOTICE_MS = 5000;
let stoppedTimer: NodeJS.Timeout | undefined;

function showStatus(text: string, command?: string): void {
  clearTimeout(stoppedTimer);
  stoppedTimer = undefined;
  status.text = `$(hubot) ${text}`;
  status.command = command;
  status.show();
}

/** Says the pet stopped, then turns back into the start button. */
function showStopped(): void {
  showStatus('Bob Pet stopped', 'bobPet.start');
  stoppedTimer = setTimeout(() => showStatus('Start Bob Pet', 'bobPet.start'), STOPPED_NOTICE_MS);
}

function setupPersistentListener(targetPort: number, targetSecret: string): void {
  if (persistentClientSocket && !persistentClientSocket.destroyed) {
    persistentClientSocket.destroy();
  }
  const socket = new Socket();
  persistentClientSocket = socket;
  socket.connect(targetPort, '127.0.0.1', () => {
    log(`Persistent listener connected to 127.0.0.1:${targetPort}`);
    socket.write(`${JSON.stringify({ version: 1, type: 'hello', secret: targetSecret })}\n`);
  });
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as Record<string, unknown>;
        if (msg.type === 'request-focus-ide') {
          log('[IPC] Received request-focus-ide from pet companion; executing workbench focus');
          void vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
        }
      } catch {
        // Ignore malformed JSON
      }
    }
  });
  socket.on('error', (err) => {
    log(`Persistent socket error: ${err.message}`);
  });
  socket.on('close', () => {
    log('Persistent socket closed');
  });
}

async function send(message: Record<string, unknown>): Promise<{ ok: boolean; reason?: string }> {
  if (!secret || port === undefined) {
    return { ok: false, reason: 'secret or port not initialized' };
  }
  const targetPort = port;
  const targetSecret = secret;
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const done = (ok: boolean, reason?: string) => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve({ ok, reason });
      }
    };
    socket.setTimeout(3000, () => done(false, 'socket timeout on loopback'));
    socket.once('error', (err) => done(false, `socket error: ${err.message}`));
    socket.connect(targetPort, '127.0.0.1', () => {
      log(`Connected to 127.0.0.1:${targetPort}, sending hello + message`);
      socket.write(`${JSON.stringify({ version: 1, type: 'hello', secret: targetSecret })}\n${JSON.stringify(message)}\n`);
    });
    socket.once('data', (chunk) => {
      const resp = chunk.toString('utf8');
      log(`Received data from pet: ${resp.trim()}`);
      done(resp.includes('true'), resp);
    });
  });
}
async function start(): Promise<void> {
  log('Starting Bob Pet...');
  port = vscode.workspace.getConfiguration('bobPet').get<number>('ipcPort', 48173);
  const existingCheck = await send({ version: 1, type: 'ping' });
  if (existingCheck.ok) {
    log('Bob Pet is already running and responded to ping.');
    showStatus('Bob Pet running', 'bobPet.setState');
    return;
  }
  let path = executable();
  log(`Configured companion path: "${path}"`);
  let spawnArgs: string[] = [];

  if (path && existsSync(path)) {
    // User configured a valid executable path directly
    log(`Using user-configured companion executable: "${path}"`);
  } else {
    // Check standard installed location or workspace development / unpacked paths
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const candidates = [
      // Standard local app installer directory
      process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Programs\\bob-pet-companion\\Bob Pet.exe` : '',
      // Workspace win-unpacked build
      wsRoot ? `${wsRoot}\\BobPet\\dist\\win-unpacked\\Bob Pet.exe` : '',
      wsRoot ? `${wsRoot}\\dist\\win-unpacked\\Bob Pet.exe` : '',
      // Development fallback using electron runner and compiled companion main
      wsRoot ? `${wsRoot}\\BobPet\\node_modules\\electron\\dist\\electron.exe` : '',
      wsRoot ? `${wsRoot}\\node_modules\\electron\\dist\\electron.exe` : ''
    ].filter((p): p is string => Boolean(p && existsSync(p)));

    if (candidates.length > 0) {
      path = candidates[0];
      log(`Discovered companion candidate: "${path}"`);
      if (path.toLowerCase().endsWith('electron.exe')) {
        const mainScript = existsSync(`${wsRoot}\\BobPet\\apps\\companion\\dist\\main\\main.js`)
          ? `${wsRoot}\\BobPet\\apps\\companion\\dist\\main\\main.js`
          : `${wsRoot}\\apps\\companion\\dist\\main\\main.js`;
        spawnArgs = [mainScript];
        log(`Using development Electron runner with main script: "${mainScript}"`);
      }
    } else {
      const msg = `Bob Pet executable not found. Please install Bob Pet or configure 'bobPet.companionPath'.`;
      log(msg);
      getLogger().show(true);
      void vscode.window.showErrorMessage(msg);
      await vscode.commands.executeCommand('workbench.action.openSettings', 'bobPet.companionPath');
      return;
    }
  }

  secret = randomBytes(32).toString('hex');
  const cleanEnv = { ...process.env };
  delete cleanEnv.ELECTRON_RUN_AS_NODE;
  delete cleanEnv.ELECTRON_NO_ASAR;

  const env = {
    ...cleanEnv,
    BOB_PET_IPC_SECRET: secret,
    BOB_PET_IPC_PORT: String(port)
  };
  log(`Spawning companion: "${path}" args=[${spawnArgs.join(' ')}] (with clean environment without parent IDE ELECTRON_RUN_AS_NODE)`);

  try {
    companion = spawn(path, spawnArgs, { detached: false, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
    
    companion.stdout?.on('data', (data) => {
      log(`[Companion stdout] ${data.toString().trim()}`);
    });
    companion.stderr?.on('data', (data) => {
      log(`[Companion stderr] ${data.toString().trim()}`);
    });
    companion.on('error', (err) => {
      log(`[Companion process error] ${err.message}`);
    });
    companion.on('exit', (code, signal) => {
      log(`[Companion exited] code=${code}, signal=${signal}`);
      companion = undefined;
      showStopped();
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log(`Failed to spawn companion process: ${errorMsg}`);
    getLogger().show(true);
    void vscode.window.showErrorMessage(`Failed to spawn Bob Pet: ${errorMsg}`);
    return;
  }

  let lastReason = '';
  for (let retry = 1; retry <= 25; retry += 1) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const result = await send({ version: 1, type: 'ping' });
    if (result.ok) {
      log(`Bob Pet handshake successful on attempt ${retry}!`);
      showStatus('Bob Pet running', 'bobPet.setState');
      setupPersistentListener(port, secret);
      void vscode.window.showInformationMessage('Bob Pet companion connected successfully!');
      return;
    }
    lastReason = result.reason ?? 'no response';
    if (retry % 5 === 0) {
      log(`Handshake attempt ${retry}/25 waiting for companion (last status: ${lastReason})...`);
    }
  }

  const failMsg = `Bob Pet did not respond on loopback port ${port}. Last error: ${lastReason}. Check 'Bob Pet' Output channel for full logs.`;
  log(failMsg);
  getLogger().show(true);
  void vscode.window.showWarningMessage(failMsg);
  showStatus('Bob Pet unavailable', 'bobPet.start');
}

function stop(): void {
  log('Stopping Bob Pet...');
  if (persistentClientSocket && !persistentClientSocket.destroyed) {
    persistentClientSocket.destroy();
  }
  persistentClientSocket = undefined;
  if (companion && !companion.killed) companion.kill();
  companion = undefined;
  secret = undefined;
  port = undefined;
  showStopped();
}

async function chooseState(): Promise<void> {
  const state = await vscode.window.showQuickPick(['IDLE', 'WORKING', 'THINKING', 'CELEBRATING', 'SLEEPING', 'FOCUS'], { placeHolder: 'Set Bob Pet state' }) as PetState | undefined;
  if (!state) return;
  const result = await send({ version: 1, type: 'set-state', state });
  if (!result.ok) {
    log(`Failed to set state to ${state}: ${result.reason}`);
    void vscode.window.showWarningMessage(`Bob Pet is not running or rejected state (${result.reason}).`);
  } else {
    log(`Pet state set to ${state}`);
  }
}


// ---------------------------------------------------------------------------
// IBM Bob hook integration
//
// Bob runs a command for each of its documented hook events (SessionStart,
// UserPromptSubmit, PreToolUse, PostToolUse, Stop), configured in its own
// settings.json. That is the sanctioned way to observe agent activity: no Bob file is
// modified, no undocumented API is called, and the user opts in explicitly by running
// the connect command. The pet's state comes from those events and nothing else.
// ---------------------------------------------------------------------------

const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const;

/**
 * The pet follows IBM Bob's own agent. Other agents that may run inside the IDE are
 * deliberately not wired up: the pet should reflect what Bob is doing, not whatever
 * else happens to be running in a panel.
 */
type HookTarget = { label: string; settings: string };
const HOOK_TARGETS: HookTarget[] = [
  { label: 'IBM Bob agent (bob-code)', settings: join(homedir(), '.bob', 'settings', 'settings.json') }
];

type HookEntry = { type: 'command'; command: string; timeout?: number; disabled?: boolean };
type HookGroup = { matcher?: string; hooks: HookEntry[] };

/**
 * Locates the companion and the hook script that ships beside it.
 *
 * Paths are assembled with `join` rather than backslash string literals: a single `\`
 * inside a template literal is an escape sequence, so `\resources\app.asar` silently
 * became a carriage return followed by mangled text, and the hook could never be found.
 */
function resolveCompanion(): { exe: string; hookScript: string } | undefined {
  const configured = executable();
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const localApps = process.env.LOCALAPPDATA ?? '';
  const candidates = [
    configured,
    localApps ? join(localApps, 'Programs', 'bob-pet-companion', 'Bob Pet.exe') : '',
    wsRoot ? join(wsRoot, 'BobPet', 'dist', 'win-unpacked', 'Bob Pet.exe') : '',
    wsRoot ? join(wsRoot, 'dist', 'win-unpacked', 'Bob Pet.exe') : '',
    wsRoot ? join(wsRoot, 'BobPet', 'node_modules', 'electron', 'dist', 'electron.exe') : '',
    wsRoot ? join(wsRoot, 'node_modules', 'electron', 'dist', 'electron.exe') : ''
  ].filter((candidate): candidate is string => Boolean(candidate && existsSync(candidate)));

  for (const exe of candidates) {
    if (exe.toLowerCase().endsWith('electron.exe')) {
      // Development checkout: the compiled hook sits in the workspace.
      for (const root of [join(wsRoot, 'BobPet'), wsRoot]) {
        const script = join(root, 'apps', 'companion', 'dist', 'main', 'hook.js');
        if (existsSync(script)) return { exe, hookScript: script };
      }
      continue;
    }
    // Installed build: the hook is packed in the asar next to the executable.
    return { exe, hookScript: join(dirname(exe), 'resources', 'app.asar', 'dist', 'main', 'hook.js') };
  }
  return undefined;
}

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
const HOOK_MARKER = 'BOB_PET_HOOK';
const HOOK_TIMEOUT_S = 5;
function hookCommand(target: { exe: string; hookScript: string }): string {
  const errorLog = join(process.env.APPDATA ?? homedir(), 'Bob Pet', 'hook-last-error.log');
  return [
    `set "${HOOK_MARKER}=1"`,
    'set "ELECTRON_RUN_AS_NODE=1"',
    'set "ELECTRON_NO_ASAR="',
    `"${target.exe}" "${target.hookScript}" 1>nul 2>"${errorLog}"`
  ].join(' & ');
}

async function readAgentSettings(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const isOurs = (entry: HookEntry): boolean => entry.command.includes(HOOK_MARKER);

/** Returns the hooks block with our entries removed, leaving anyone else's intact. */
function withoutPetHooks(hooks: Record<string, HookGroup[]>): Record<string, HookGroup[]> {
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
async function applyHooks(target: HookTarget, entry: HookEntry | undefined): Promise<void> {
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

async function connect(): Promise<void> {
  const companion = resolveCompanion();
  if (!companion) {
    void vscode.window.showErrorMessage(
      "Bob Pet companion not found. Install it or set 'bobPet.companionPath', then run Connect again."
    );
    return;
  }

  const command = hookCommand(companion);
  // Kept short on purpose: the full command runs to several hundred characters, and a
  // long detail grows the modal until its buttons are pushed off a small screen. The
  // exact command goes to the output channel instead, where it can be read in full.
  log(`Connect: hook command is ${command}`);
  const choice = await vscode.window.showInformationMessage(
    'Let Bob Pet follow IBM Bob? The pet will react to your messages and to Bob using tools.',
    {
      modal: true,
      detail:
        `Adds ${HOOK_EVENTS.length} hooks to ${HOOK_TARGETS[0].settings}\n\n` +
        'The hook prints nothing and always exits 0, so it cannot change or block anything Bob does. ' +
        'See the Bob Pet output channel for the exact command, and run "Bob Pet: Disconnect from IBM Bob" to undo.'
    },
    'Add hooks'
  );
  if (choice !== 'Add hooks') return;

  const entry: HookEntry = { type: 'command', command, timeout: HOOK_TIMEOUT_S };
  for (const target of HOOK_TARGETS) {
    await applyHooks(target, entry);
    log(`Installed hooks into ${target.settings}`);
  }

  // Run it once exactly as an agent would, so a broken wiring is reported now rather
  // than as a pet that silently never moves.
  const check = await smokeTest(command);
  if (!check.ok) {
    log(`Hook smoke test failed: ${check.detail}`);
    getLogger().show(true);
    void vscode.window.showWarningMessage(
      `Bob Pet hooks were installed, but the hook command failed a test run: ${check.detail}`
    );
    return;
  }
  void vscode.window.showInformationMessage(
    'Bob Pet is connected and the hook responded. Start a new task to see it react.'
  );
}

/** Invokes the shim the way both agents do: `exec` with the payload on stdin. */
function smokeTest(command: string): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const child = exec(command, { timeout: 10000, windowsHide: true }, (error, stdout) => {
      const code = typeof error?.code === 'number' ? error.code : error ? null : 0;
      if (code !== 0) {
        resolve({ ok: false, detail: `exit code ${String(code)} (is the companion installed?)` });
      } else if (stdout.trim()) {
        // Output would be injected into the model's context, so this must never happen.
        resolve({ ok: false, detail: 'the hook printed to stdout' });
      } else {
        resolve({ ok: true, detail: 'ok' });
      }
    });
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(JSON.stringify({ session_id: 'bob-pet-smoke-test', cwd: '', hook_event_name: 'SessionStart', source: 'startup' }));
  });
}

async function disconnect(): Promise<void> {
  for (const target of HOOK_TARGETS) {
    await applyHooks(target, undefined);
    log(`Removed hooks from ${target.settings}`);
  }
  void vscode.window.showInformationMessage('Bob Pet hooks removed.');
}

export function activate(context: vscode.ExtensionContext): void {
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  showStatus('Start Bob Pet', 'bobPet.start');

  context.subscriptions.push(
    status,
    getLogger(),
    vscode.commands.registerCommand('bobPet.start', start),
    vscode.commands.registerCommand('bobPet.stop', stop),
    vscode.commands.registerCommand('bobPet.focus', async () => {
      const res = await send({ version: 1, type: 'focus-request' });
      if (!res.ok) void vscode.window.showWarningMessage('Bob Pet is not running.');
    }),
    vscode.commands.registerCommand('bobPet.setState', chooseState),
    vscode.commands.registerCommand('bobPet.connect', connect),
    vscode.commands.registerCommand('bobPet.disconnect', disconnect),
    vscode.commands.registerCommand('bobPet.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', 'bobPet'))
  );
}

export function deactivate(): void {
  stop();
  clearTimeout(stoppedTimer);
}
