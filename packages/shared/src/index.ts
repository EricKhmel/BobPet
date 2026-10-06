export const PROTOCOL_VERSION = 1 as const;

export const PET_STATES = ['IDLE', 'WORKING', 'THINKING', 'CELEBRATING', 'SLEEPING', 'FOCUS'] as const;
export type PetState = (typeof PET_STATES)[number];
export type Message =
  | { version: 1; type: 'hello'; secret: string }
  | { version: 1; type: 'set-state'; state: PetState; label?: string; source?: 'bob' }
  | { version: 1; type: 'focus-request' }
  | { version: 1; type: 'request-focus-ide' }
  | { version: 1; type: 'ping' };

/** Bubble text is shown on screen only; it is never written to disk or sent anywhere. */
export const MAX_LABEL = 120;
const cleanLabel = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  // Control and format characters are dropped, not just collapsed: a right-to-left
  // override would let a repository's file name reorder what the pet says Bob is doing.
  const flat = value.replace(/\p{C}/gu, '').replace(/\s+/g, ' ').trim();
  return flat ? flat.slice(0, MAX_LABEL) : undefined;
};

const exactKeys = (input: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(input).length === keys.length && keys.every((key) => Object.hasOwn(input, key));

/** Validates the deliberately tiny, versioned local IPC surface. */
export function parseMessage(input: unknown): Message | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const value = input as Record<string, unknown>;
  if (value.version !== PROTOCOL_VERSION || typeof value.type !== 'string') return undefined;
  if (value.type === 'hello' && exactKeys(value, ['version', 'type', 'secret']) && typeof value.secret === 'string' && value.secret.length >= 32) {
    return { version: 1, type: 'hello', secret: value.secret };
  }
  const isState = typeof value.state === 'string' && PET_STATES.includes(value.state as PetState);
  // `source` says the report came from one of Bob's own hooks rather than from a person
  // choosing a state. Only Bob finishing its work ends by itself; a state you picked stays.
  const allowed = ['version', 'type', 'state', 'label', 'source'];
  const knownKeys = Object.keys(value).every((key) => allowed.includes(key));
  const source = value.source === 'bob' ? ('bob' as const) : undefined;
  const sourceOk = value.source === undefined || source !== undefined;
  if (value.type === 'set-state' && isState && knownKeys && sourceOk) {
    const label = cleanLabel(value.label);
    const message: Message = { version: 1, type: 'set-state', state: value.state as PetState };
    return { ...message, ...(label ? { label } : {}), ...(source ? { source } : {}) };
  }
  if ((value.type === 'focus-request' || value.type === 'request-focus-ide' || value.type === 'ping') && exactKeys(value, ['version', 'type'])) {
    return { version: 1, type: value.type };
  }
  return undefined;
}

export type PetScaleName = 'mini' | 'standard' | 'medium' | 'large' | 'xl';
export const PET_SCALES: Record<PetScaleName, { multiplier: number; pixels: number; label: string }> = {
  mini: { multiplier: 0.75, pixels: 48, label: 'Mini' }, standard: { multiplier: 1, pixels: 64, label: 'Standard' },
  medium: { multiplier: 1.5, pixels: 96, label: 'Medium' }, large: { multiplier: 2, pixels: 128, label: 'Large' }, xl: { multiplier: 3, pixels: 192, label: 'XL' }
};
/**
 * Empty rows above the character. The hard hat reaches the top of the 64-row design, so
 * without this a celebration jump or a quick drag would slice off the crown.
 */
export const PET_HEADROOM_ROWS = 4;
/** Logical canvas: 64 columns by 64 design rows plus the headroom. */
export const PET_GRID_ROWS = 64 + PET_HEADROOM_ROWS;
/** On-screen height of the pet at a given width, keeping its pixels square. */
export const petHeightFor = (width: number): number => Math.round((width * PET_GRID_ROWS) / 64);
/**
 * How solid the pet is, as a percentage. 100 is the pet as drawn; lower lets the window
 * behind it show through, for anyone who wants it present without it being in the way.
 */
export const PET_OPACITIES = [25, 50, 75, 100] as const;
export type PetOpacity = (typeof PET_OPACITIES)[number];
export const isPetOpacity = (value: unknown): value is PetOpacity =>
  typeof value === 'number' && (PET_OPACITIES as readonly number[]).includes(value);

export type StoredSettings = { schemaVersion: 1; scale: PetScaleName; opacity: PetOpacity; muted: boolean; paused: boolean; animationEnabled: boolean; bobExecutablePath?: string; position?: { x: number; y: number }; idleMinutes: number };
export const defaultSettings = (): StoredSettings => ({ schemaVersion: 1, scale: 'medium', opacity: 100, muted: true, paused: false, animationEnabled: true, idleMinutes: 15 });
export function migrateSettings(value: unknown): StoredSettings {
  const defaults = defaultSettings();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const source = value as Record<string, unknown>;
  const scale = typeof source.scale === 'string' && Object.hasOwn(PET_SCALES, source.scale) ? source.scale as PetScaleName : defaults.scale;
  const position = source.position && typeof source.position === 'object' && typeof (source.position as Record<string, unknown>).x === 'number' && typeof (source.position as Record<string, unknown>).y === 'number'
    ? { x: (source.position as { x: number }).x, y: (source.position as { y: number }).y } : undefined;
  return { ...defaults, scale, opacity: isPetOpacity(source.opacity) ? source.opacity : defaults.opacity, muted: typeof source.muted === 'boolean' ? source.muted : defaults.muted, paused: typeof source.paused === 'boolean' ? source.paused : defaults.paused, animationEnabled: typeof source.animationEnabled === 'boolean' ? source.animationEnabled : defaults.animationEnabled, bobExecutablePath: typeof source.bobExecutablePath === 'string' ? source.bobExecutablePath : undefined, position, idleMinutes: typeof source.idleMinutes === 'number' && source.idleMinutes >= 1 && source.idleMinutes <= 240 ? source.idleMinutes : defaults.idleMinutes };
}
export type Bounds = { x: number; y: number; width: number; height: number };
export function clampPosition(position: { x: number; y: number } | undefined, displays: Bounds[], size: number): { x: number; y: number } {
  const fallback = displays[0] ?? { x: 0, y: 0, width: 1920, height: 1080 };
  if (!position) return { x: fallback.x + 24, y: fallback.y + 24 };
  const containing = displays.find((d) => position.x >= d.x - size && position.x <= d.x + d.width && position.y >= d.y - size && position.y <= d.y + d.height) ?? fallback;
  return { x: Math.max(containing.x, Math.min(position.x, containing.x + containing.width - size)), y: Math.max(containing.y, Math.min(position.y, containing.y + containing.height - size)) };
}

/** Velocity of an in-flight drag, in logical pixels per animation frame. */
export type DragMotion = { dragging: boolean; vx: number; vy: number };

/** Windows uses a 4px slop before a press counts as a drag; matching it keeps a shaky click a click. */
export const DRAG_THRESHOLD_PX = 4;
export type DragOutcome = { moved: boolean; position?: { x: number; y: number } };
/**
 * Decides whether a held pointer has become a drag yet, and where the window belongs.
 * Once the threshold is crossed the gesture stays a drag, so the pet does not snap
 * back to click behaviour if the cursor wanders back to the origin.
 */
export function dragOutcome(
  origin: { x: number; y: number },
  cursor: { x: number; y: number },
  windowStart: { x: number; y: number },
  alreadyMoved: boolean
): DragOutcome {
  const dx = cursor.x - origin.x;
  const dy = cursor.y - origin.y;
  if (!alreadyMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return { moved: false };
  return { moved: true, position: { x: windowStart.x + dx, y: windowStart.y + dy } };
}

/**
 * Whether a press on the pet begins a click or a drag, rather than asking for its menu.
 *
 * Control+click is how a Mac without a secondary button asks for a context menu, but it
 * arrives as the primary button with the control key held, not as the secondary button.
 * Treating it as an ordinary press starts a drag, and the native menu that opens next takes
 * the release with it - so nothing ever ends that drag, and the pet follows the cursor
 * around until it is clicked again. Elsewhere Control+click is just a click.
 */
export const isPrimaryPress = (press: { button: number; ctrlKey: boolean }, mac: boolean): boolean =>
  press.button === 0 && !(mac && press.ctrlKey);

/**
 * Maps one IBM Bob hook payload to a pet state.
 *
 * Bob's documented hook events are SessionStart, UserPromptSubmit, PreToolUse,
 * PostToolUse and Stop, each delivered as JSON on stdin. Tools are classified from
 * `tool_name` at runtime rather than through `matcher` regexes in the settings file,
 * so the mapping survives Bob renaming or adding tools.
 */
const READ_ONLY_TOOL = /read|search|list|grep|glob|find|view|browse|fetch|codebase|definition|inspect/i;

export function stateForHook(payload: unknown): PetState | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const event = payload as { hook_event_name?: unknown; tool_name?: unknown };
  switch (event.hook_event_name) {
    case 'SessionStart':
      return 'IDLE';
    case 'UserPromptSubmit':
      return 'THINKING';
    case 'PostToolUse':
      return 'THINKING';
    case 'Stop':
      return 'CELEBRATING';
    case 'PreToolUse':
      // Reading and searching is concentration; running or changing things is work.
      return typeof event.tool_name === 'string' && READ_ONLY_TOOL.test(event.tool_name) ? 'FOCUS' : 'WORKING';
    default:
      return undefined;
  }
}

export { describeHook, describeTool } from './describe.js';
export { STILL_RUNNING_MS, formatElapsed, startTally, countStep, wrapUp, type TaskTally } from './summary.js';
export { dropDuration, dropIn, type Drop } from './entrance.js';

/**
 * Where the pet keeps its settings and the session file the hooks read.
 *
 * Electron hands the app this path, but two things that need it cannot ask Electron: the
 * hook, which runs as bare node, and the extension, which is not Electron at all. This
 * mirrors Electron's own choice per platform, so all three agree.
 */
export function petDataDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = ''
): string {
  const house = home || env.HOME || env.USERPROFILE || '';
  const roaming = env.APPDATA ?? `${house}\\AppData\\Roaming`;
  if (platform === 'win32') return `${roaming}\\${PET_APP_NAME}`;
  if (platform === 'darwin') return `${house}/Library/Application Support/${PET_APP_NAME}`;
  return `${env.XDG_CONFIG_HOME || `${house}/.config`}/${PET_APP_NAME}`;
}

/** The application's name, which is also the folder its data lives in. */
export const PET_APP_NAME = 'Bob Pet';
