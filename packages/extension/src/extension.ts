import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { Socket } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { exec, spawn, type ChildProcess } from 'node:child_process';
import { type PetState } from '@bob-pet/shared';
import { HOOK_EVENTS, HOOK_TARGETS, HOOK_TIMEOUT_S, applyHooks, hookCommand, installedPetHooks, type HookEntry } from './hooks.js';
import { canDownload, companionExe, ensureDownloadedCompanion } from './install.js';
import { COMPANION_RELEASE } from './release.js';

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

/**
 * The port the running pet published for this launch.
 *
 * The pet takes any free port when the configured one is in use, so the number we asked
 * for is only a request. It writes what it got to `session.json` in its own user-data
 * folder, which is also where the hooks read it from. A stale file is harmless: the
 * handshake still has to succeed with the secret this window generated.
 */
async function publishedPort(): Promise<number | undefined> {
  const appData = process.env.APPDATA;
  if (!appData) return undefined;
  try {
    const raw = JSON.parse(await readFile(join(appData, 'Bob Pet', 'session.json'), 'utf8')) as { port?: unknown };
    return typeof raw.port === 'number' && raw.port > 0 && raw.port <= 65535 ? raw.port : undefined;
  } catch {
    return undefined;
  }
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
    const candidates = companionCandidates().filter((candidate) => existsSync(candidate));

    if (candidates.length > 0) {
      path = candidates[0];
      log(`Discovered companion candidate: "${path}"`);
      if (path.toLowerCase().endsWith('electron.exe')) {
        // Only reachable in a development checkout (see companionCandidates).
        const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        const mainScript = existsSync(join(wsRoot, 'BobPet', 'apps', 'companion', 'dist', 'main', 'main.js'))
          ? join(wsRoot, 'BobPet', 'apps', 'companion', 'dist', 'main', 'main.js')
          : join(wsRoot, 'apps', 'companion', 'dist', 'main', 'main.js');
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
    // Give the requested port a fair chance before believing a file about it.
    if (retry === 6) {
      const published = await publishedPort();
      if (published !== undefined && published !== port) {
        log(`Port ${String(port)} did not answer; session.json says the pet took ${published}`);
        port = published;
      }
    }
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


/**
 * Every place the companion may legitimately be, best first.
 *
 * Deliberately nothing from the open folder. Earlier versions looked for a build inside
 * the workspace, which meant that merely opening a repository containing
 * `dist\win-unpacked\Bob Pet.exe` - or a stock `electron.exe` and a `main.js` - was
 * enough to have it spawned, and `refreshHooks` would then write that path into Bob's
 * own settings, where it would keep running long after the repository was gone. A
 * checkout is still supported for development, but only when the person running it says
 * so by setting BOB_PET_DEV, never because of what a repository happens to contain.
 *
 * `bobPet.companionPath` is machine-scoped in the manifest for the same reason: a
 * workspace must not be able to choose which executable this extension starts.
 */
function companionCandidates(): string[] {
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const localApps = process.env.LOCALAPPDATA ?? '';
  const development = process.env.BOB_PET_DEV && wsRoot
    ? [
        join(wsRoot, 'BobPet', 'dist', 'win-unpacked', 'Bob Pet.exe'),
        join(wsRoot, 'dist', 'win-unpacked', 'Bob Pet.exe'),
        join(wsRoot, 'BobPet', 'node_modules', 'electron', 'dist', 'electron.exe'),
        join(wsRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
      ]
    : [];
  return [
    executable(),
    // What this extension downloaded for itself, which is how most people will have it.
    storageRoot && COMPANION_RELEASE.version ? companionExe(storageRoot) : '',
    localApps ? join(localApps, 'Programs', 'bob-pet-companion', 'Bob Pet.exe') : '',
    ...development
  ].filter((candidate): candidate is string => Boolean(candidate));
}

/**
 * Locates the companion and the hook script that ships beside it.
 *
 * Paths are assembled with `join` rather than backslash string literals: a single `\`
 * inside a template literal is an escape sequence, so `\resources\app.asar` silently
 * became a carriage return followed by mangled text, and the hook could never be found.
 */
function resolveCompanion(): { exe: string; hookScript: string } | undefined {
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const candidates = companionCandidates().filter((candidate) => existsSync(candidate));

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
 * Applies a hook change, and says so plainly if Bob's settings could not be read. They are
 * left exactly as they were in that case, so the user can fix the file and try again.
 */
async function writeHooks(entry: HookEntry | undefined): Promise<boolean> {
  for (const target of HOOK_TARGETS) {
    try {
      await applyHooks(target, entry);
      log(`${entry ? 'Installed' : 'Removed'} hooks ${entry ? 'into' : 'from'} ${target.settings}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log(`Left Bob's settings alone: ${reason}`);
      getLogger().show(true);
      void vscode.window.showErrorMessage(`Bob Pet did not change Bob's settings: ${reason}`);
      return false;
    }
  }
  return true;
}

async function connect(options: { ask?: boolean } = {}): Promise<void> {
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
  const choice = options.ask === false ? 'Add hooks' : await vscode.window.showInformationMessage(
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
  if (!(await writeHooks(entry))) return;

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
  if (!(await writeHooks(undefined))) return;
  void vscode.window.showInformationMessage('Bob Pet hooks removed.');
}

/**
 * Everything the pet needs, set up in one step the first time the extension runs.
 *
 * Installing an extension should be all anyone has to do, but two of the things the pet
 * needs are the user's to allow: a one-time download of the companion application, and
 * hooks in Bob's settings so it can see what Bob is doing. Both are named in a single
 * prompt, and "Not now" is remembered so nobody is asked again at every startup. The
 * commands stay available for anyone who changes their mind.
 */
const DECLINED = 'bobPet.declinedSetup';

async function setUp(context: vscode.ExtensionContext, asked: boolean): Promise<void> {
  if (resolveCompanion()) return;
  if (!canDownload()) {
    log('No companion found and this build has no download configured; use bobPet.companionPath.');
    return;
  }
  if (!asked && context.globalState.get<boolean>(DECLINED)) return;

  const size = COMPANION_RELEASE.bytes ? `${Math.round(COMPANION_RELEASE.bytes / 1e6)}MB` : 'about 100MB';
  const choice = await vscode.window.showInformationMessage(
    'Set up Bob Pet?',
    {
      modal: true,
      detail:
        `This downloads the pet (${size}, once) and adds ${HOOK_EVENTS.length} hooks to ${HOOK_TARGETS[0].settings} ` +
        'so it can react to what Bob is doing.\n\n' +
        'The download is checked against a fingerprint built into this extension before it runs. The hooks print ' +
        'nothing and always exit 0, so they cannot change or block anything Bob does. Uninstalling removes them.'
    },
    'Set up Bob Pet'
  );
  if (choice !== 'Set up Bob Pet') {
    await context.globalState.update(DECLINED, true);
    log('Set-up declined; the pet will stay out of the way until a Bob Pet command is run.');
    return;
  }
  await context.globalState.update(DECLINED, false);

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Bob Pet', cancellable: false },
      async (progress) => {
        let last = 0;
        await ensureDownloadedCompanion(
          storageRoot,
          (message, fraction) => {
            const percent = fraction === undefined ? 0 : Math.round(fraction * 100);
            progress.report({ message, increment: Math.max(0, percent - last) });
            if (fraction !== undefined) last = percent;
          },
          log
        );
      }
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(`Companion download failed: ${reason}`);
    const retry = await vscode.window.showErrorMessage(`Bob Pet could not be downloaded: ${reason}`, 'Try again');
    if (retry === 'Try again') await setUp(context, true);
    return;
  }

  await connect({ ask: false });
  await start();
}

/**
 * Keeps installed hooks pointing at the companion that is actually there.
 *
 * Every extension update installs to a new folder, so a hook written by an earlier
 * version names a path that no longer exists. Only entries the pet owns are rewritten,
 * and only when they have gone stale; a user who never connected stays unhooked.
 */
async function refreshHooks(): Promise<void> {
  const companion = resolveCompanion();
  if (!companion) return;
  const wanted = hookCommand(companion);
  for (const target of HOOK_TARGETS) {
    const existing = await installedPetHooks(target);
    if (existing.length === 0 || existing.every((command) => command === wanted)) continue;
    try {
      await applyHooks(target, { type: 'command', command: wanted, timeout: HOOK_TIMEOUT_S });
      log(`Updated the pet's hooks in ${target.settings} to the current companion`);
    } catch (error) {
      // A refresh runs unasked at startup, so it reports quietly and changes nothing.
      log(`Could not refresh the hooks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

let storageRoot = '';

/**
 * The pet is a Windows application: it is focused, hooked and packaged with Windows-only
 * machinery. The extension is published for Windows alone, so most hosts will not even
 * offer it elsewhere, but one installed by hand says so plainly rather than failing in
 * the middle of a download.
 */
const WINDOWS_ONLY = 'Bob Pet works on Windows only for now. Support for macOS and Linux is not ready yet.';
const COMMAND_IDS = ['bobPet.start', 'bobPet.stop', 'bobPet.focus', 'bobPet.setState', 'bobPet.connect', 'bobPet.disconnect', 'bobPet.openSettings'];

export function activate(context: vscode.ExtensionContext): void {
  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  showStatus('Start Bob Pet', 'bobPet.start');
  storageRoot = context.globalStorageUri.fsPath;

  if (process.platform !== 'win32') {
    log(`${WINDOWS_ONLY} (this is ${process.platform})`);
    showStatus('Bob Pet: Windows only');
    void vscode.window.showWarningMessage(WINDOWS_ONLY);
    context.subscriptions.push(
      status,
      getLogger(),
      ...COMMAND_IDS.map((id) => vscode.commands.registerCommand(id, () => vscode.window.showWarningMessage(WINDOWS_ONLY)))
    );
    return;
  }

  void (async () => {
    await refreshHooks();
    await setUp(context, false);
    if (vscode.workspace.getConfiguration('bobPet').get<boolean>('autoStart', true) && resolveCompanion()) await start();
  })();

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
    vscode.commands.registerCommand('bobPet.connect', () => connect()),
    vscode.commands.registerCommand('bobPet.disconnect', disconnect),
    vscode.commands.registerCommand('bobPet.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', 'bobPet'))
  );
}

export function deactivate(): void {
  stop();
  clearTimeout(stoppedTimer);
}
