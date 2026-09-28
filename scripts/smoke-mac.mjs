/**
 * Starts the packaged macOS pet and puts it through the same path IBM Bob would.
 *
 * This runs against the finished .vsix, not the build tree: it unpacks the extension the
 * way the editor does, unpacks the pet the way the extension does, launches it, and
 * delivers a hook event exactly as Bob delivers one. That covers everything except how it
 * looks on screen, which needs a person.
 *
 *   node scripts/smoke-mac.mjs dist/bob-pet-darwin-arm64.vsix
 */
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { connect } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const vsix = process.argv[2];
if (!vsix) {
  console.error('usage: node scripts/smoke-mac.mjs <vsix>');
  process.exit(1);
}

const PORT = 48899;
const SECRET = 'smoke'.padEnd(64, '0');
const steps = [];
const note = (ok, what, detail = '') => {
  steps.push({ ok, what, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ` - ${detail}` : ''}`);
};
const exists = (path) => stat(path).then(() => true, () => false);

const work = await mkdtemp(join(tmpdir(), 'bob-pet-smoke-'));
const unpacked = join(work, 'extension');
const petHome = join(work, 'pet');
await mkdir(unpacked, { recursive: true });
await mkdir(petHome, { recursive: true });

// 1. The editor unpacks the VSIX, which is a zip.
await run('/usr/bin/unzip', ['-q', vsix, '-d', unpacked]);
const archive = join(unpacked, 'extension', 'companion', 'companion-mac.tar.gz');
note(await exists(archive), 'the extension carries the pet as a tar archive', archive.replace(work, ''));

// 2. The extension unpacks that archive, which is what keeps symlinks and permissions.
await run('/usr/bin/tar', ['-xzf', archive, '-C', petHome]);
const binary = join(petHome, 'Bob Pet.app', 'Contents', 'MacOS', 'Bob Pet');
note(await exists(binary), 'unpacking produces an application bundle');
const mode = await stat(binary).then((s) => s.mode & 0o111, () => 0);
note(mode !== 0, 'the binary survived with its executable bit', `mode ${mode.toString(8)}`);
const hookScript = join(petHome, 'Bob Pet.app', 'Contents', 'Resources', 'app.asar', 'dist', 'main', 'hook.js');
note(await exists(join(petHome, 'Bob Pet.app', 'Contents', 'Resources', 'app.asar')), 'the hook script ships inside the bundle');

// 3. macOS must be willing to run it at all: unsigned code is refused outright on arm64.
const signature = await run('/usr/bin/codesign', ['-dv', join(petHome, 'Bob Pet.app')]).then(
  () => 'signed',
  (error) => (String(error.stderr ?? error).includes('not signed') ? 'unsigned' : 'unknown')
);
// Only enforced for the architecture this runner can actually check.
if (process.arch === 'arm64') {
  note(signature !== 'unsigned', `the bundle carries a signature (${signature})`, signature === 'unsigned' ? 'macOS refuses unsigned apps on Apple Silicon' : '');
}

// 4. The pet starts and answers on its loopback connection, as the extension expects.
const target = process.argv[3] ?? process.arch;
// A build for the other architecture cannot be launched here without Rosetta, so the
// running checks are skipped rather than reported as product failures.
const runnable = target === process.arch;
if (!runnable) console.log(`SKIP  launching a ${target} build on a ${process.arch} runner`);

const pet = runnable
  ? spawn(binary, [], { env: { ...process.env, BOB_PET_IPC_SECRET: SECRET, BOB_PET_IPC_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] })
  : undefined;
let petSaid = '';
pet?.stdout.on('data', (d) => { petSaid += d; });
pet?.stderr.on('data', (d) => { petSaid += d; });

const ask = (port, secret, message) => new Promise((resolve) => {
  const socket = connect(port, '127.0.0.1', () => {
    socket.write(`${JSON.stringify({ version: 1, type: 'hello', secret })}\n${JSON.stringify(message)}\n`);
  });
  socket.on('data', (d) => { resolve(d.toString().trim()); socket.end(); });
  socket.on('error', (e) => resolve(`error: ${e.code}`));
  setTimeout(() => resolve('no answer'), 5000);
});

let answered = 'no answer';
if (runnable) {
  for (let attempt = 0; attempt < 20 && !answered.includes('true'); attempt += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    answered = await ask(PORT, SECRET, { version: 1, type: 'ping' });
  }
  note(answered.includes('true'), 'the pet starts and answers on loopback', answered.slice(0, 120));
}

// 5. It publishes where the hooks should find it.
const sessionFile = join(homedir(), 'Library', 'Application Support', 'Bob Pet', 'session.json');
if (runnable) {
  const session = await readFile(sessionFile, 'utf8').then((t) => JSON.parse(t), () => undefined);
  note(Boolean(session?.port), 'it publishes its session where the hook looks', sessionFile.replace(homedir(), '~'));
}

// 6. A hook event, delivered the way Bob delivers one: as bare node, stdin, nothing printed.
const hook = !runnable ? { code: 0, stdout: '', stderr: '' } : await new Promise((resolve) => {
  const child = execFile(
    binary,
    [hookScript],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10_000 },
    (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr })
  );
  child.stdin.end(JSON.stringify({ session_id: 'smoke', cwd: work, hook_event_name: 'PreToolUse', tool_name: 'execute_command', tool_input: { command: 'npm test' } }));
});
if (runnable) {
  note(hook.code === 0, 'a hook event runs and exits 0', `code ${hook.code}`);
  note(hook.stdout === '', 'the hook prints nothing back to Bob', JSON.stringify(hook.stdout).slice(0, 80));
}

pet?.kill();
await rm(work, { recursive: true, force: true });

const failed = steps.filter((s) => !s.ok);
if (petSaid.trim()) console.log('\n--- what the pet said ---\n' + petSaid.trim().split('\n').slice(0, 20).join('\n'));
if (failed.length) {
  const detail = failed.map((s) => `${s.what}${s.detail ? ` (${s.detail})` : ''}`).join('~');
  console.log(`::error title=macOS smoke test failed::${detail}`);
  process.exit(1);
}
console.log(`\nAll ${steps.length} checks passed.`);
