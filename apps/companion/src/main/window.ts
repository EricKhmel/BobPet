import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { PET_SCALES, clampPosition, type StoredSettings } from '@bob-pet/shared';
import { layoutFor, windowOrigin } from './layout.js';
export const petSize = (settings: StoredSettings) => PET_SCALES[settings.scale].pixels;
/** The pet's own box is kept on screen; the clear room around it may hang off the edge. */
export const safePetPosition = (position: { x: number; y: number } | undefined, size: number) =>
  clampPosition(position, screen.getAllDisplays().map((display) => display.workArea), layoutFor(size).petHeight);
export function createPetWindow(settings: StoredSettings): BrowserWindow {
  const size = petSize(settings); const layout = layoutFor(size); const { width, height } = layout; const position = windowOrigin(safePetPosition(settings.position, size), layout);
  const mac = process.platform === 'darwin';
  const window = new BrowserWindow({ width, height, x: position.x, y: position.y, transparent: true, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, show: false, focusable: true,
    // macOS draws a rectangular shadow and rounds the corners of a frameless window, both
    // of which show up as grey edges around a pet whose own corners are transparent.
    hasShadow: !mac, roundedCorners: !mac, webPreferences: { preload: join(__dirname, '../preload/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.setMinimumSize(width, height); window.setMaximumSize(width, height);
  // Clear pixels pass the mouse through; the renderer takes it back over the pet (see main.ts).
  window.setIgnoreMouseEvents(true, { forward: true });
  // 'floating' on macOS keeps the pet above ordinary windows without covering the menu bar
  // or notification banners, which 'screen-saver' would. skipTransformProcessType stops the
  // call below from briefly turning the pet into a Dock application.
  window.setAlwaysOnTop(true, mac ? 'floating' : 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  window.setMenuBarVisibility(false);
  return window;
}
