// First, so it is in place before node:sqlite is loaded further down.
import './quiet.js';
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, screen } from 'electron';
import { randomBytes } from 'node:crypto';
import { PET_SCALES, countStep, dragOutcome, dropDuration, dropIn, migrateSettings, startTally, wrapUp, type PetScaleName, type PetState, type TaskTally } from '@bob-pet/shared';
import { LocalPetServer } from './ipc-server.js';
import { WindowsFocusAdapter } from './focus.js';
import { SettingsStore } from './settings.js';
import { createPetWindow, petSize, safePetPosition } from './window.js';
import { removeSessionFile, writeSessionFile } from './session-file.js';
import { layoutFor, petOrigin, windowOrigin, type Bubble } from './layout.js';
import { bobDatabasePath, pendingApprovalsSince, stepLine } from './bob-approvals.js';

// Must run before anything reads a user-data path: Electron derives userData from the
// app name, which otherwise falls back to the package name (%APPDATA%\@bob-pet\companion).
app.setName('Bob Pet');

let petWindow: BrowserWindow | undefined;
let store: SettingsStore;
let state: PetState = 'IDLE';
let server: LocalPetServer | undefined;
let sessionSecret: string | undefined;
const focusAdapter = new WindowsFocusAdapter();
const argument = (name: string): string | undefined => {
  for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === name) return process.argv[i + 1];
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
};
const notify = (body: string): void => { if (Notification.isSupported()) new Notification({ title: 'Bob Pet', body }).show(); };
/** Saves where the pet itself is, not the window around it, so a size change keeps it put. */
async function persistBounds(): Promise<void> { if (!petWindow || drag || entranceTimer) return; const settings = await store.read(); const { x, y } = petWindow.getBounds(); await store.write({ ...settings, position: petOrigin({ x, y }, layoutFor(petSize(settings))) }); }
const CELEBRATE_MS = 6400;
/** The task in progress, if any: when it began and what it has done so far. */
let task: TaskTally | undefined;

let bubble: Bubble | undefined;

/**
 * Tells the renderer what the pet is saying. The window already has room for any line
 * (see layout.ts), so nothing is resized here and the pet never blinks as lines change.
 */
async function applyBubble(next: Bubble | undefined): Promise<void> {
  bubble = next;
  if (!petWindow) return;
  const size = petSize(await store.read());
  petWindow.webContents.send('pet:bubble', { bubble: bubble ?? null, petLeft: layoutFor(size).petLeft, petSize: size });
}

/** Fits the window to a pet size, keeping the pet's own box where it was. */
function fitWindow(size: number, pet: { x: number; y: number }): void {
  if (!petWindow) return;
  const layout = layoutFor(size);
  const origin = windowOrigin(safePetPosition(pet, size), layout);
  petWindow.setMinimumSize(1, 1);
  petWindow.setMaximumSize(10000, 10000);
  petWindow.setBounds({ ...origin, width: layout.width, height: layout.height }, false);
  petWindow.setMinimumSize(layout.width, layout.height);
  petWindow.setMaximumSize(layout.width, layout.height);
}
let revertTimer: NodeJS.Timeout | undefined;
let sleepTimer: NodeJS.Timeout | undefined;

/**
 * Hook events say what just happened, not how long it lasts. A finished task should
 * cheer briefly and settle, and a quiet agent should eventually doze, so those two
 * transitions are owned here rather than depending on a further event arriving.
 */
async function setState(next: PetState, label?: string, source?: 'bob'): Promise<void> {
  state = next;
  const now = Date.now();
  const busy = next === 'THINKING' || next === 'WORKING' || next === 'FOCUS';
  const step = next === 'WORKING' || next === 'FOCUS';

  // A task runs from the first busy event to Bob stopping; its tally feeds the wrap-up.
  let line = label;
  if (busy) {
    task ??= startTally(now);
    if (step && label !== undefined) countStep(task, label);
  } else {
    if (next === 'CELEBRATING' && task && label !== undefined) line = wrapUp(task, now);
    task = undefined;
  }

  petWindow?.webContents.send('pet:state', next);
  // The line stays up until the next event replaces it, so it reflects the step Bob is on.
  // Busy lines carry when the step began, so the bubble can show a timer on long ones.
  if (line !== undefined) await applyBubble(busy ? { text: line, since: now } : { text: line });

  // Any new event means the previous step is over, approved or not.
  clearStepWatch();
  if (line !== undefined && step) watchStep(line, now);

  clearTimeout(revertTimer);
  clearTimeout(sleepTimer);
  revertTimer = undefined;
  sleepTimer = undefined;
  if (next === 'SLEEPING') { await applyBubble(undefined); return; }

  // Only a celebration Bob raised ends by itself. One picked from the menu or sent by the
  // extension is a state the user chose, and it stays until they choose another.
  if (next === 'CELEBRATING' && source === 'bob') {
    revertTimer = setTimeout(() => {
      void applyBubble(undefined);
      void setState('IDLE');
    }, CELEBRATE_MS);
    return;
  }
  const { idleMinutes } = await store.read();
  sleepTimer = setTimeout(() => void setState('SLEEPING'), Math.max(1, idleMinutes) * 60_000);
}

/**
 * The pet drops in from above and bounces to a stop when it launches.
 *
 * The window is only as tall as the pet, so the fall is the window moving: the renderer
 * runs the same timeline (see entrance.ts) to squash him on each landing. The saved
 * position is left alone throughout, since none of this is the user moving him.
 */
const ENTRANCE_FRAME_MS = 16;
let entranceTimer: NodeJS.Timeout | undefined;

function playEntrance(): void {
  if (!petWindow) return;
  const [x, restY] = petWindow.getPosition();
  // He falls from the top of the screen he is on, so a pet already near the top has a
  // correspondingly short fall rather than starting off screen where it cannot be seen.
  const ceiling = screen.getDisplayNearestPoint({ x, y: restY }).workArea.y;
  const height = Math.max(0, restY - ceiling);
  const total = dropDuration(height);
  const at = (ms: number): number => Math.round(restY - dropIn(ms, height).rise);
  petWindow.setPosition(x, at(0));
  petWindow.showInactive();
  // The renderer runs the same timeline for the squash, so it needs the same fall.
  petWindow.webContents.send('pet:entrance', { height });
  const started = Date.now();
  entranceTimer = setInterval(() => {
    const elapsed = Date.now() - started;
    if (!petWindow || elapsed >= total) {
      clearInterval(entranceTimer);
      entranceTimer = undefined;
      petWindow?.setPosition(x, restY);
      return;
    }
    petWindow.setPosition(x, at(elapsed));
  }, ENTRANCE_FRAME_MS);
}

/**
 * Shows the pet once, either dropping in or simply appearing. The renderer asks for this
 * as soon as it has painted, since only it knows whether the user asked for less motion;
 * a timer covers a renderer that never gets that far.
 */
let revealed = false;
async function reveal(withEntrance: boolean): Promise<void> {
  if (revealed || !petWindow) return;
  revealed = true;
  const settings = await store.read();
  if (!withEntrance || settings.paused) {
    petWindow.showInactive();
    return;
  }
  playEntrance();
}

/** The pet's own overlay must never be mistaken for the IBM Bob window. */
function ownWindowHandle(): bigint {
  try {
    const handle = petWindow?.getNativeWindowHandle();
    if (!handle) return 0n;
    return handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
  } catch {
    return 0n;
  }
}

type DragSession = {
  origin: { x: number; y: number };
  windowStart: { x: number; y: number };
  size: { width: number; height: number };
  last: { x: number; y: number };
  vx: number;
  vy: number;
  timer: NodeJS.Timeout;
  moved: boolean;
};
let drag: DragSession | undefined;

/**
 * The window is moved from here rather than from renderer pointermove deltas: the
 * window slides out from under the cursor, which skews every following client
 * coordinate and makes the drag judder. Polling the global cursor has no such loop.
 */
function startDrag(): void {
  if (!petWindow || drag) return;
  const [startX, startY] = petWindow.getPosition();
  const [width, height] = petWindow.getSize();
  const session: DragSession = {
    origin: screen.getCursorScreenPoint(),
    windowStart: { x: startX, y: startY },
    size: { width, height },
    last: { x: startX, y: startY },
    vx: 0,
    vy: 0,
    moved: false,
    timer: setInterval(() => {
      if (!petWindow || !drag) return;
      const outcome = dragOutcome(drag.origin, screen.getCursorScreenPoint(), drag.windowStart, drag.moved);
      if (!outcome.position) return;
      drag.moved = true;
      // Raw per-frame deltas are too jittery to drive a pose, so they are smoothed.
      drag.vx = drag.vx * 0.7 + (outcome.position.x - drag.last.x) * 0.3;
      drag.vy = drag.vy * 0.7 + (outcome.position.y - drag.last.y) * 0.3;
      drag.last = outcome.position;
      petWindow.setBounds({ ...outcome.position, ...drag.size }, false);
      petWindow.webContents.send('pet:drag', { dragging: true, vx: drag.vx, vy: drag.vy });
    }, 16)
  };
  drag = session;
}

/** Returns whether the gesture turned out to be a drag, so the renderer can skip the click. */
async function endDrag(): Promise<boolean> {
  if (!drag) return false;
  clearInterval(drag.timer);
  const moved = drag.moved;
  drag = undefined;
  if (!moved || !petWindow) return moved;
  // Only a real drag reports a release, so a plain click never triggers the landing squash.
  petWindow.webContents.send('pet:drag', { dragging: false, vx: 0, vy: 0 });
  // Clamped only on drop, so a drag is free to cross monitors on the way.
  const [x, y] = petWindow.getPosition();
  const size = petSize(await store.read());
  fitWindow(size, petOrigin({ x, y }, layoutFor(size)));
  await persistBounds();
  return true;
}

/**
 * Watches the step Bob is on, and says it needs you only when Bob has recorded that it does.
 *
 * A pending approval is read from Bob's own record of it (see bob-approvals.ts) rather
 * than inferred from silence: a slow build and a blocked tool look identical from a hook,
 * and the timer that used to guess raised a false alarm on every long command. Rows are
 * only counted from shortly before this step began, so leftovers from abandoned sessions
 * never count. If the record cannot be read, the pet says nothing about approvals at all.
 */
const STEP_POLL_MS = 750;
/** Covers the gap between Bob stamping a request and this process seeing the hook. */
const APPROVAL_SLACK_MS = 2_000;
let stepTimer: NodeJS.Timeout | undefined;

function watchStep(label: string, started: number): void {
  clearStepWatch();
  const database = bobDatabasePath();
  let shown = label;
  let alerted = false;
  stepTimer = setInterval(() => {
    const pending = pendingApprovalsSince(database, started - APPROVAL_SLACK_MS);
    if (pending === undefined) noteUnreadableApprovals();
    const text = stepLine(label, Date.now() - started, pending);
    if (pending && !alerted) {
      alerted = true;
      notify(`Bob needs your OK: ${label}`);
    }
    if (text === shown) return;
    shown = text;
    void applyBubble({ text, since: started });
  }, STEP_POLL_MS);
}

/**
 * Says once, in the log, that Bob's own record of pending approvals could not be read.
 * The pet stays quiet about approvals in that case, so without this line a Bob update
 * that moved or renamed the table would look like nothing at all had changed.
 */
let approvalsWarned = false;
function noteUnreadableApprovals(): void {
  if (approvalsWarned) return;
  approvalsWarned = true;
  console.log(`Cannot read Bob's pending approvals in ${bobDatabasePath()}; the pet will not say when Bob needs you. This is expected if this version of Bob keeps them elsewhere.`);
}

function clearStepWatch(): void {
  clearInterval(stepTimer);
  stepTimer = undefined;
}

let focusInFlight: Promise<void> | undefined;
async function focusBob(): Promise<void> {
  // A press generates click + dblclick on nested handlers; collapse them into one activation.
  if (focusInFlight) return focusInFlight;
  focusInFlight = (async () => {
    // 1. Ask a connected extension to focus the editor from inside the host.
    server?.notifyExtensionFocusRequest();
    // 2. Restore and raise the real IBM Bob window, excluding our own overlay.
    const result = await focusAdapter.focusConfiguredApp({
      path: (await store.read()).bobExecutablePath,
      excludePids: [process.pid],
      excludeWindowHandle: ownWindowHandle()
    });
    // Success needs no announcement - the IBM Bob window coming forward is the feedback,
    // and a banner over the pet just covers him up. Only a failure is worth saying.
    if (!result.ok) {
      petWindow?.webContents.send('pet:notice', result.message);
      notify(result.message);
    }
  })().finally(() => { focusInFlight = undefined; });
  return focusInFlight;
}

async function chooseBobExecutable(): Promise<void> {
  const settings = await store.read();
  const picked = await dialog.showOpenDialog({
    title: 'Select the IBM Bob executable',
    defaultPath: settings.bobExecutablePath,
    properties: ['openFile'],
    filters: [{ name: 'Applications', extensions: ['exe'] }]
  });
  const [chosen] = picked.filePaths;
  if (picked.canceled || !chosen) return;
  const next = { ...settings, bobExecutablePath: chosen };
  await store.write(next);
  petWindow?.webContents.send('pet:settings', next);
  petWindow?.webContents.send('pet:notice', 'IBM Bob location saved');
}
async function resize(scale: PetScaleName): Promise<void> {
  const settings = await store.read();
  const next = { ...settings, scale };
  if (petWindow) {
    const [x, y] = petWindow.getPosition();
    fitWindow(petSize(next), petOrigin({ x, y }, layoutFor(petSize(settings))));
  }
  await store.write(next);
  await applyBubble(bubble);
  await persistBounds();
  petWindow?.webContents.send('pet:settings', next);
}
async function contextMenu(): Promise<void> {
  const currentSettings = await store.read();
  const states = (['IDLE', 'WORKING', 'THINKING', 'CELEBRATING', 'SLEEPING', 'FOCUS'] as PetState[]).map((stateValue) => ({
    label: stateValue[0] + stateValue.slice(1).toLowerCase(),
    type: 'radio' as const,
    checked: state === stateValue,
    click: () => void setState(stateValue)
  }));
  const scales = (Object.keys(PET_SCALES) as PetScaleName[]).map((scaleKey) => ({
    label: `${PET_SCALES[scaleKey].label} (${PET_SCALES[scaleKey].pixels}px)`,
    type: 'radio' as const,
    checked: currentSettings.scale === scaleKey,
    click: () => void resize(scaleKey)
  }));
  const menu = Menu.buildFromTemplate([
    { label: 'Pet State', submenu: states },
    { label: 'Size', submenu: scales },
    { type: 'separator' },
    { label: 'Focus IBM Bob', click: () => void focusBob() },
    { label: 'Set IBM Bob Location…', click: () => void chooseBobExecutable() },
    {
      label: 'Pause Pet',
      type: 'checkbox',
      checked: currentSettings.paused,
      click: async (item) => {
        const next = { ...currentSettings, paused: item.checked };
        await store.write(next);
        petWindow?.webContents.send('pet:settings', next);
      }
    },
    { type: 'separator' },
    { label: 'Quit Bob Pet', click: () => app.quit() }
  ]);
  menu.popup();
}
async function startup(): Promise<void> {
  // Start IPC server immediately; read from environment or CLI args
  const secret = process.env.BOB_PET_IPC_SECRET ?? argument('--ipc-secret') ?? randomBytes(32).toString('hex');
  const requestedPort = Number(process.env.BOB_PET_IPC_PORT ?? argument('--ipc-port') ?? '48173');
  const portToUse = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65535 ? requestedPort : 48173;
  server = new LocalPetServer(secret, (next, label, source) => void setState(next, label, source), () => void focusBob());
  const actualPort = await server.start(portToUse);
  console.log(`Bob Pet IPC server listening on 127.0.0.1:${actualPort}`);
  if (actualPort !== portToUse) console.log(`Port ${portToUse} was taken; hooks and the extension will find this one in session.json`);

  // Spawn the focus helper now so the first click does not pay PowerShell startup.
  focusAdapter.warmUp();

  // Published for the hook command, which Bob spawns fresh for every event.
  sessionSecret = secret;
  await writeSessionFile(app.getPath('userData'), { port: actualPort, secret });

  store = new SettingsStore();
  if (await store.migrate()) console.log('Adopted settings from the legacy user-data folder');
  const settings = await store.read();
  petWindow = createPetWindow(settings);
  // Only a development build follows this. In a packaged pet it is ignored, so nothing
  // that can set an environment variable can point the window at a page of its choosing.
  const devServer = app.isPackaged ? undefined : process.env.BOB_PET_DEV_SERVER;
  await petWindow.loadURL(devServer ?? `file://${__dirname}/../renderer/index.html`);
  // The renderer normally asks to be shown; this covers it failing to load at all.
  petWindow.once('ready-to-show', () => setTimeout(() => void reveal(false), 800));
  petWindow.on('moved', () => void persistBounds());
  petWindow.webContents.on('context-menu', () => contextMenu());

  screen.on('display-removed', async () => {
    if (!petWindow) return;
    const size = petSize(await store.read());
    const [x, y] = petWindow.getPosition();
    fitWindow(size, petOrigin({ x, y }, layoutFor(size)));
    await persistBounds();
  });
}

app.whenReady().then(startup).catch((error: unknown) => { console.error('Bob Pet startup failed', error); app.quit(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { clearStepWatch(); clearInterval(entranceTimer); entranceTimer = undefined; void server?.close(); focusAdapter.dispose(); if (sessionSecret) void removeSessionFile(app.getPath('userData'), sessionSecret); });
ipcMain.handle('pet:settings', () => store.read());
ipcMain.handle('pet:set-scale', (_event, scale: PetScaleName) => resize(scale));
ipcMain.handle('pet:set-state', (_event, next: PetState) => setState(next));
ipcMain.handle('pet:focus', () => {
  console.log('[IPC] pet:focus invoked from renderer');
  return focusBob();
});
ipcMain.handle('pet:menu', () => contextMenu());
ipcMain.handle('pet:ready', (_event, info: { reducedMotion?: boolean } | undefined) => reveal(!info?.reducedMotion));
ipcMain.handle('pet:drag-start', () => startDrag());
// The renderer reports whether the cursor is over something of the pet's. Elsewhere the
// window lets the mouse through, so its clear room never blocks what is behind it. A drag
// keeps the mouse, even if the cursor briefly outruns the window.
ipcMain.on('pet:hit', (_event, over: boolean) => {
  if (!petWindow || drag) return;
  petWindow.setIgnoreMouseEvents(!over, { forward: true });
});
ipcMain.handle('pet:drag-end', () => endDrag());
ipcMain.handle('pet:save-settings', async (_event, update: Record<string, unknown>) => {
  const settings = await store.read();
  // Put the merge through the same validation as a settings file read from disk, so the
  // renderer cannot store a shape the rest of the app does not expect.
  const next = migrateSettings({ ...settings, ...update });
  await store.write(next);
  petWindow?.webContents.send('pet:settings', next);
});
