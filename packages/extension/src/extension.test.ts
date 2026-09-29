import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage, PET_STATES } from '@bob-pet/shared';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOOK_EVENTS, HOOK_MARKER, applyHooks, hooksCanRun, installedPetHooks } from './hooks.js';

test('extension protocol payload does not permit arbitrary commands', () => {
  assert.equal(parseMessage({ version: 1, type: 'run', command: 'whoami' }), undefined);
  assert.equal(parseMessage({ version: 1, type: 'exec', script: 'calc.exe' }), undefined);
  assert.equal(parseMessage({ version: 1, type: 'eval', code: 'process.exit()' }), undefined);
});

test('extension protocol payload only validates safe known types and states', () => {
  for (const state of PET_STATES) {
    assert.deepEqual(parseMessage({ version: 1, type: 'set-state', state }), {
      version: 1,
      type: 'set-state',
      state
    });
  }
  assert.deepEqual(parseMessage({ version: 1, type: 'focus-request' }), {
    version: 1,
    type: 'focus-request'
  });
  assert.deepEqual(parseMessage({ version: 1, type: 'request-focus-ide' }), {
    version: 1,
    type: 'request-focus-ide'
  });
  assert.deepEqual(parseMessage({ version: 1, type: 'ping' }), {
    version: 1,
    type: 'ping'
  });
});

test('a window with no folder open stops Bob running hooks everywhere but Windows', async (t) => {
  // Bob hands its workspace to exec as the hook's working directory, and an empty string
  // is not a directory on POSIX. This is the whole reason the extension warns.
  assert.equal(hooksCanRun('', 'darwin'), false);
  assert.equal(hooksCanRun('   ', 'linux'), false);
  assert.equal(hooksCanRun('/Users/someone/project', 'darwin'), true);
  // Windows starts the process regardless, which is why this was never seen there.
  assert.equal(hooksCanRun('', 'win32'), true);

  // And the claim itself, checked against the platform actually running the test.
  const { exec } = await import('node:child_process');
  const ran = await new Promise<boolean>((resolve) => {
    exec('echo hi', { cwd: '', timeout: 5000 }, (error) => resolve(!error));
  });
  t.diagnostic(`exec with an empty cwd on ${process.platform}: ${ran ? 'ran' : 'failed to start'}`);
  assert.equal(ran, hooksCanRun('', process.platform), 'the warning must match what this platform really does');
});

test("hooks are not written when Bob's settings cannot be read", async () => {
  const root = await mkdtemp(join(tmpdir(), 'bob-pet-hooks-'));
  const settings = join(root, 'settings.json');
  const target = { label: 'test', settings };
  const entry = { type: 'command' as const, command: `set "${HOOK_MARKER}=1" & pet.exe`, timeout: 5 };

  // A file that is not there yet is fine to create.
  await applyHooks(target, entry);
  const created = JSON.parse(await readFile(settings, 'utf8')) as { hooks: Record<string, unknown> };
  assert.equal(Object.keys(created.hooks).length, HOOK_EVENTS.length);

  // Someone else's settings are kept, and only our own entries come back out.
  await writeFile(settings, JSON.stringify({ model: 'theirs', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'their-script.cmd' }] }] } }), 'utf8');
  await applyHooks(target, entry);
  await applyHooks(target, undefined);
  const after = JSON.parse(await readFile(settings, 'utf8')) as { model: string; hooks: Record<string, unknown[]> };
  assert.equal(after.model, 'theirs', 'their other settings must survive');
  assert.deepEqual(after.hooks.Stop, [{ hooks: [{ type: 'command', command: 'their-script.cmd' }] }], "their own hook must survive");

  // A file we cannot parse is someone's configuration: refuse, and leave it exactly as is.
  const broken = '{ "model": "theirs", ';
  await writeFile(settings, broken, 'utf8');
  await assert.rejects(() => applyHooks(target, entry), /could not be read as JSON/);
  assert.equal(await readFile(settings, 'utf8'), broken, 'the unreadable file must be untouched');
  assert.deepEqual(await installedPetHooks(target), [], 'and nothing is claimed to be installed');

  await rm(root, { recursive: true, force: true });
});
