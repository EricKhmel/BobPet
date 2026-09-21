export const PROTOCOL_VERSION = 1 as const;

export const PET_STATES = ['IDLE', 'WORKING', 'THINKING', 'CELEBRATING', 'SLEEPING', 'FOCUS'] as const;
export type PetState = (typeof PET_STATES)[number];
export type Message =
  | { version: 1; type: 'hello'; secret: string }
  | { version: 1; type: 'set-state'; state: PetState; label?: string }
  | { version: 1; type: 'focus-request' }
  | { version: 1; type: 'request-focus-ide' }
  | { version: 1; type: 'ping' };

/** Bubble text is shown on screen only; it is never written to disk or sent anywhere. */
export const MAX_LABEL = 120;
const cleanLabel = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const flat = value.replace(/\s+/g, ' ').trim();
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
  if (value.type === 'set-state' && isState && (exactKeys(value, ['version', 'type', 'state']) || exactKeys(value, ['version', 'type', 'state', 'label']))) {
    const label = cleanLabel(value.label);
    return label ? { version: 1, type: 'set-state', state: value.state as PetState, label } : { version: 1, type: 'set-state', state: value.state as PetState };
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
export type StoredSettings = { schemaVersion: 1; scale: PetScaleName; muted: boolean; paused: boolean; animationEnabled: boolean; bobExecutablePath?: string; position?: { x: number; y: number }; idleMinutes: number };
export const defaultSettings = (): StoredSettings => ({ schemaVersion: 1, scale: 'standard', muted: true, paused: false, animationEnabled: true, idleMinutes: 15 });
export function migrateSettings(value: unknown): StoredSettings {
  const defaults = defaultSettings();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  const source = value as Record<string, unknown>;
  const scale = typeof source.scale === 'string' && Object.hasOwn(PET_SCALES, source.scale) ? source.scale as PetScaleName : defaults.scale;
  const position = source.position && typeof source.position === 'object' && typeof (source.position as Record<string, unknown>).x === 'number' && typeof (source.position as Record<string, unknown>).y === 'number'
    ? { x: (source.position as { x: number }).x, y: (source.position as { y: number }).y } : undefined;
  return { ...defaults, scale, muted: typeof source.muted === 'boolean' ? source.muted : defaults.muted, paused: typeof source.paused === 'boolean' ? source.paused : defaults.paused, animationEnabled: typeof source.animationEnabled === 'boolean' ? source.animationEnabled : defaults.animationEnabled, bobExecutablePath: typeof source.bobExecutablePath === 'string' ? source.bobExecutablePath : undefined, position, idleMinutes: typeof source.idleMinutes === 'number' && source.idleMinutes >= 1 && source.idleMinutes <= 240 ? source.idleMinutes : defaults.idleMinutes };
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
