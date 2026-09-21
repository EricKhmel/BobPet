import type { PetState } from './index.js';

/**
 * Turns one IBM Bob hook payload into the short line the pet says.
 *
 * The text is rendered on the user's own screen and never stored, logged or sent
 * anywhere, but it does put file names and command fragments in view, so it is kept to a
 * verb and one short target rather than echoing whole commands or prompts.
 */

const VERBS: [RegExp, string][] = [
  [/exec|command|terminal|bash|shell|run/i, 'Running'],
  [/insert|replace|apply|diff|edit|modify/i, 'Editing'],
  [/delete|remove/i, 'Deleting'],
  [/write|create|new_file/i, 'Writing'],
  [/search|grep|glob|codebase/i, 'Searching'],
  [/list|tree/i, 'Listing'],
  [/read|view|open|inspect|definition/i, 'Reading'],
  [/fetch|browse|url|web/i, 'Fetching'],
  [/todo|plan/i, 'Planning'],
  [/ask|question|followup/i, 'Asking']
];

/** Keys Bob's tools use for the thing being acted on, most specific first. */
const TARGET_KEYS = ['command', 'path', 'file_path', 'filePath', 'file', 'filename', 'pattern', 'query', 'search', 'url', 'directory', 'dir'];

const TARGET_MAX = 42;

function shorten(value: string): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  if (flat.length <= TARGET_MAX) return flat;
  return `${flat.slice(0, TARGET_MAX - 1)}…`;
}

/** File-ish targets read better as a basename than as a full path. */
function tidyTarget(raw: string, key: string): string {
  const value = raw.trim();
  if (key === 'command' || key === 'query' || key === 'search') return shorten(value);
  const segments = value.split(/[\\/]/).filter(Boolean);
  return shorten(segments.length > 1 ? segments[segments.length - 1] : value);
}

function targetOf(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return '';
  const source = input as Record<string, unknown>;
  for (const key of TARGET_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return tidyTarget(value, key);
  }
  return '';
}

function verbOf(toolName: string): string {
  for (const [pattern, verb] of VERBS) if (pattern.test(toolName)) return verb;
  return 'Using';
}

/** The phrase describing a tool call, e.g. "Running npm test" or "Reading index.ts". */
export function describeTool(toolName: unknown, toolInput: unknown): string {
  const name = typeof toolName === 'string' && toolName.trim() ? toolName.trim() : 'a tool';
  const verb = verbOf(name);
  const target = targetOf(toolInput);
  if (target) return `${verb} ${target}`;
  if (verb === 'Using') return `Using ${name.replace(/_/g, ' ')}`;
  return `${verb} something`;
}

/** The line the pet says for a hook event, or undefined when it has nothing to add. */
export function describeHook(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const event = payload as { hook_event_name?: unknown; tool_name?: unknown; tool_input?: unknown };
  switch (event.hook_event_name) {
    case 'SessionStart':
      return 'Ready when you are';
    case 'UserPromptSubmit':
      return 'Thinking about that…';
    case 'PreToolUse':
      return describeTool(event.tool_name, event.tool_input);
    case 'PostToolUse':
      return 'Thinking…';
    case 'Stop':
      return 'All done';
    default:
      return undefined;
  }
}

export type { PetState };
