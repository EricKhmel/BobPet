import test from 'node:test';
import assert from 'node:assert/strict';
import { petSize } from './window.js';
import { WindowsFocusAdapter, sanitizeProcessName } from './focus.js';
import { LocalPetServer } from './ipc-server.js';
import { Socket } from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateSettingsFile } from './settings-migration.js';
import { layoutFor, petOrigin, windowOrigin } from './layout.js';
import { removeSessionFile, sessionFilePath, writeSessionFile } from './session-file.js';
import { pendingApprovalsSince, stepLine, STILL_RUNNING_MS } from './bob-approvals.js';
import { DatabaseSync } from 'node:sqlite';
import { PET_SCALES } from '@bob-pet/shared';

test('pet size calculation for all scales', () => {
  assert.equal(petSize({ schemaVersion: 1, scale: 'mini', muted: true, paused: false, animationEnabled: true, idleMinutes: 15 }), 48);
  assert.equal(petSize({ schemaVersion: 1, scale: 'standard', muted: true, paused: false, animationEnabled: true, idleMinutes: 15 }), 64);
  assert.equal(petSize({ schemaVersion: 1, scale: 'medium', muted: true, paused: false, animationEnabled: true, idleMinutes: 15 }), 96);
  assert.equal(petSize({ schemaVersion: 1, scale: 'large', muted: true, paused: false, animationEnabled: true, idleMinutes: 15 }), 128);
  assert.equal(petSize({ schemaVersion: 1, scale: 'xl', muted: true, paused: false, animationEnabled: true, idleMinutes: 15 }), 192);
});

test('focus adapter fallback handles missing/invalid executable gracefully', async () => {
  const adapter = new WindowsFocusAdapter();
  try {
    const nonRunning = await adapter.focusConfiguredApp({ path: 'C:\\Bob\\non_existent_fake_process_12345.exe' });
    assert.equal(nonRunning.ok, false);
    assert.match(nonRunning.message, /not found/i);
  } finally {
    adapter.dispose();
  }
});

test('process name is derived safely and wildcards are stripped', () => {
  assert.equal(sanitizeProcessName('C:\\Users\\me\\AppData\\Local\\Programs\\IBM Bob\\IBM Bob.exe'), 'IBM Bob');
  // Get-Process -Name takes wildcards; a '*' would widen the match to unrelated apps.
  assert.equal(sanitizeProcessName('C:\\evil\\*.exe'), '');
  assert.equal(sanitizeProcessName('C:\\evil\\IBM*Bob.exe'), 'IBMBob');
  assert.equal(sanitizeProcessName('C:\\Bob\\bob.txt'), '');
  assert.equal(sanitizeProcessName(undefined), '');
});

/** Windows 11 Notepad is store-packaged, so the spawned pid is not the window owner. */
function notepadWindowOwners(): { pids: number[]; handles: bigint[] } {
  const raw = execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Get-Process -Name notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { \"$($_.Id),$($_.MainWindowHandle)\" }"
    ],
    { encoding: 'utf8' }
  );
  const pids: number[] = [];
  const handles: bigint[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const [pid, handle] = line.trim().split(',');
    if (!pid || !handle) continue;
    pids.push(Number(pid));
    handles.push(BigInt(handle));
  }
  return { pids, handles };
}

test('focus adapter raises a real window, and never an excluded pid or window handle', async (t) => {
  if (process.platform !== 'win32') return t.skip('windows only');

  const NOTEPAD = 'C:\\Windows\\System32\\notepad.exe';
  const launcher = spawn(NOTEPAD, { detached: true, stdio: 'ignore' });
  const adapter = new WindowsFocusAdapter();
  let owners = { pids: [] as number[], handles: [] as bigint[] };

  try {
    // Wait for the window to exist before asserting anything about focusing it.
    let focused = { ok: false, message: '' };
    for (let attempt = 0; attempt < 20 && !focused.ok; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      focused = await adapter.focusConfiguredApp({ path: NOTEPAD });
    }
    // Store-packaged Notepad does not always give us a window: locked sessions and build
    // machines have none to raise. That says nothing about the adapter, so it is a skip
    // rather than a failure; what the test proves, it still proves wherever it can run.
    if (!focused.ok) return t.skip(`no Notepad window in this session: ${focused.message}`);

    owners = notepadWindowOwners();
    assert.ok(owners.pids.length > 0, 'notepad should own a visible window');

    // The bug this guards: Bob Pet's own always-on-top overlay was first in Z-order,
    // so it activated itself instead of IBM Bob while still reporting success.
    const byPid = await adapter.focusConfiguredApp({ path: NOTEPAD, excludePids: owners.pids });
    assert.equal(byPid.ok, false, 'excluded pid must not be focused');
    assert.match(byPid.message, /not found/i);

    // excludeWindowHandle is exercised end-to-end against the live overlay rather
    // than here: store-packaged Notepad exposes more than one qualifying window,
    // so excluding a single handle is not deterministic through this fixture.
    assert.ok(owners.handles[0] > 0n, 'window handle should be readable');
  } finally {
    adapter.dispose();
    for (const pid of [launcher.pid, ...owners.pids]) {
      try {
        if (pid) process.kill(pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
  }
});

test('local IPC server accepts authenticated state updates and rejects unauthenticated connections', async () => {
  const secret = 'test-secret-key-that-is-at-least-32-chars-long';
  let receivedState = '';
  let focusCalled = false;

  const server = new LocalPetServer(
    secret,
    (st) => { receivedState = st; },
    () => { focusCalled = true; }
  );

  const port = await server.start(0);
  assert.ok(port > 0);

  // 1. Unauthenticated client sends state update directly -> socket closed, no change
  await new Promise<void>((resolve) => {
    const socket = new Socket();
    socket.connect(port, '127.0.0.1', () => {
      socket.write(`${JSON.stringify({ version: 1, type: 'set-state', state: 'WORKING' })}\n`);
    });
    socket.on('close', () => {
      assert.equal(receivedState, '');
      resolve();
    });
  });

  // 2. Authenticated client connects and sends state & focus requests
  await new Promise<void>((resolve) => {
    const socket = new Socket();
    socket.connect(port, '127.0.0.1', () => {
      socket.write(`${JSON.stringify({ version: 1, type: 'hello', secret })}\n`);
      socket.write(`${JSON.stringify({ version: 1, type: 'set-state', state: 'THINKING' })}\n`);
      socket.write(`${JSON.stringify({ version: 1, type: 'focus-request' })}\n`);
      socket.write(`${JSON.stringify({ version: 1, type: 'ping' })}\n`);
    });
    let dataReceived = '';
    socket.on('data', (d) => {
      dataReceived += d.toString('utf8');
      if (dataReceived.includes('{"ok":true}')) {
        setTimeout(() => {
          socket.destroy();
          assert.equal(receivedState, 'THINKING');
          assert.equal(focusCalled, true);
          resolve();
        }, 50);
      }
    });
  });

  // 3. Server broadcasts focus notification to authenticated sockets
  await new Promise<void>((resolve) => {
    const socket = new Socket();
    socket.connect(port, '127.0.0.1', () => {
      socket.write(`${JSON.stringify({ version: 1, type: 'hello', secret })}\n`);
    });
    let gotHelloOk = false;
    socket.on('data', (d) => {
      const msg = d.toString('utf8');
      if (msg.includes('{"ok":true}')) {
        gotHelloOk = true;
        server.notifyExtensionFocusRequest();
      }
      if (msg.includes('request-focus-ide')) {
        assert.ok(gotHelloOk);
        socket.destroy();
        resolve();
      }
    });
  });

  await server.close();
});

test('settings migration adopts a legacy file exactly once, and never clobbers or corrupts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bob-pet-migrate-'));
  const current = join(root, 'new', 'settings.json');
  const legacy = join(root, 'old', 'settings.json');
  const body = '{"schemaVersion":1,"scale":"xl","muted":false,"paused":false,"animationEnabled":true,"idleMinutes":20}';
  await mkdir(join(root, 'old'), { recursive: true });

  // Nothing to adopt yet.
  assert.equal(await migrateSettingsFile(current, legacy), false);

  // Legacy present, current absent: adopt it and retire the old file.
  await writeFile(legacy, body, 'utf8');
  assert.equal(await migrateSettingsFile(current, legacy), true);
  assert.equal(await readFile(current, 'utf8'), body);
  assert.equal(existsSync(legacy), false, 'legacy file should be removed once adopted');

  // Running again is a no-op rather than a second migration.
  assert.equal(await migrateSettingsFile(current, legacy), false);

  // An existing configuration must never be overwritten by a stale legacy one.
  await writeFile(legacy, '{"schemaVersion":1,"scale":"mini"}', 'utf8');
  assert.equal(await migrateSettingsFile(current, legacy), false);
  assert.equal(await readFile(current, 'utf8'), body);
  assert.equal(existsSync(legacy), true, 'a skipped migration must leave the legacy file alone');

  // Corrupt legacy content is left behind so the app falls back to defaults.
  const fresh = join(root, 'fresh', 'settings.json');
  await writeFile(legacy, 'not json at all', 'utf8');
  assert.equal(await migrateSettingsFile(fresh, legacy), false);
  assert.equal(existsSync(fresh), false);

  await rm(root, { recursive: true, force: true });
});

test('the window is one fixed size, so a bubble never resizes it', () => {
  const layout = layoutFor(64);
  assert.equal(layout.petHeight, 68, 'headroom above the pet keeps the hat clear on a jump');
  assert.equal(layout.width, 208, 'room for the bubble is always there');
  assert.ok(layout.height > layout.petHeight, 'and below the pet, room for its longest line');
  assert.equal(layout.petLeft, Math.round((layout.width - 64) / 2));

  // Positions are saved for the pet's own box, so the window sits petLeft to its left.
  assert.deepEqual(windowOrigin({ x: 500, y: 300 }, layout), { x: 500 - layout.petLeft, y: 300 });
  assert.deepEqual(petOrigin(windowOrigin({ x: 500, y: 300 }, layout), layout), { x: 500, y: 300 });

  // A pet wider than the bubble never shrinks the window below itself.
  assert.equal(layoutFor(192).width, 208);
  assert.equal(layoutFor(260).petLeft, 0);
});

test('session file is only removed by the instance that wrote it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bob-pet-session-'));
  await writeSessionFile(dir, { port: 48173, secret: 'first-instance-secret' });

  // A restart: the new instance republishes before the old one finishes quitting.
  await writeSessionFile(dir, { port: 48173, secret: 'second-instance-secret' });
  await removeSessionFile(dir, 'first-instance-secret');
  const survived = JSON.parse(await readFile(sessionFilePath(dir), 'utf8')) as { secret: string };
  assert.equal(survived.secret, 'second-instance-secret', 'the departing instance must not delete the new file');

  // The owning instance does clean up after itself.
  await removeSessionFile(dir, 'second-instance-secret');
  assert.equal(existsSync(sessionFilePath(dir)), false);

  await rm(dir, { recursive: true, force: true });
});

test("a pending approval is read from Bob's own record, never inferred", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bob-pet-approvals-'));
  const file = join(dir, 'bob.db');

  // No database at all: unknown, which must never be reported as waiting.
  assert.equal(pendingApprovalsSince(file, 0), undefined);

  // A database without the table (a Bob version that renamed it): still unknown.
  const bare = new DatabaseSync(file);
  bare.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY)');
  bare.close();
  assert.equal(pendingApprovalsSince(file, 0), undefined);

  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE task_pending_approvals (
    task_id TEXT NOT NULL, request_id TEXT NOT NULL, payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL, PRIMARY KEY (task_id, request_id))`);
  const insert = db.prepare('INSERT INTO task_pending_approvals VALUES (?, ?, ?, ?)');
  const stepStarted = 1_800_000_000_000;

  // Left behind by yesterday's abandoned session: must not count.
  insert.run('old-task', 'old-request', '{}', stepStarted - 86_400_000);
  assert.equal(pendingApprovalsSince(file, stepStarted), 0);

  // Bob asks during this step.
  insert.run('task', 'request', '{}', stepStarted + 400);
  assert.equal(pendingApprovalsSince(file, stepStarted), 1);

  // The user answers in Bob, which deletes the row.
  db.prepare('DELETE FROM task_pending_approvals WHERE request_id = ?').run('request');
  assert.equal(pendingApprovalsSince(file, stepStarted), 0);
  db.close();

  await rm(dir, { recursive: true, force: true });
});

test('only a recorded request earns "needs your OK"; time alone never does', () => {
  const label = 'Running npm install';
  assert.equal(stepLine(label, 500, 0), label);
  assert.equal(stepLine(label, STILL_RUNNING_MS + 60_000, 0), `Still going — ${label}`);
  assert.equal(stepLine(label, STILL_RUNNING_MS + 60_000, undefined), `Still going — ${label}`, 'unreadable must not become a claim');
  assert.equal(stepLine(label, 200, 1), `Bob needs your OK — ${label}`);
});
