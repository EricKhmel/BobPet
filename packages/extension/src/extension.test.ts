import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMessage, PET_STATES } from '@bob-pet/shared';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOOK_EVENTS, HOOK_MARKER, applyHooks, hookWorkingDir, hooksCanRun, installedPetHooks } from './hooks.js';

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

test('Bob cannot run a hook from a directory that does not exist', async (t) => {
  const { exec } = await import('node:child_process');
  const runIn = (cwd: string): Promise<number | null> =>
    new Promise((resolve) => {
      exec('echo hi', { cwd, timeout: 5000 }, (error) =>
        // Exactly how Bob reads the result: anything without a numeric code is "hook failed".
        resolve(typeof (error as { code?: unknown })?.code === 'number' ? (error as { code: number }).code : error ? null : 0)
      );
    });

  // The failure the extension warns about, measured rather than assumed.
  const missing = join(tmpdir(), `bob-pet-not-here-${String(process.pid)}`);
  assert.equal(await runIn(missing), null, 'a missing working directory must give Bob no exit code at all');
  assert.equal(hooksCanRun(missing), false);

  // A real directory works, on every platform.
  assert.equal(await runIn(tmpdir()), 0);
  assert.equal(hooksCanRun(tmpdir()), true);

  // An empty working directory is discarded by Node before the process starts, so it is
  // harmless everywhere. An earlier version of this check blamed it; this is why it must
  // be measured on the platform running the test rather than reasoned about.
  const empty = await runIn('');
  t.diagnostic(`exec with an empty cwd on ${process.platform}: exit ${String(empty)}`);
  assert.equal(empty, 0, 'an empty cwd must not be what stops a hook');
});

test('the working directory Bob will use, with a folder open and without one', () => {
  const home = process.platform === 'win32' ? 'C:\\Users\\someone' : '/Users/someone';
  // A folder open is the folder itself.
  assert.equal(hookWorkingDir('/work/project', {}, home), '/work/project');
  // No folder open is Bob's playground, which is the case that catches people out: a
  // machine that has never used it does not have that directory.
  assert.equal(hookWorkingDir(undefined, {}, home), join(home, '.bob', 'playground'));
  assert.equal(hookWorkingDir('', {}, home), join(home, '.bob', 'playground'));
  // And Bob's own setting moves it.
  assert.equal(hookWorkingDir(undefined, { playgroundPath: '/somewhere/else' }, home), '/somewhere/else');
  assert.equal(hookWorkingDir(undefined, { playgroundPath: '   ' }, home), join(home, '.bob', 'playground'));
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
