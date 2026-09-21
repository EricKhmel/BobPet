/**
 * What the pet keeps about the task in progress, for the timer and the wrap-up line.
 *
 * Everything is derived from the lines the hooks already send ("Running npm test",
 * "Editing index.ts"), whose first word is a verb from describe.ts, so the wire protocol
 * does not change. It lives in memory only and is dropped when the task ends.
 */

/** A step has run this long before the pet says it is still going and shows a timer. */
export const STILL_RUNNING_MS = 12_000;

/** "42s", "4m 12s" or "1h 05m". */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export type TaskTally = { startedAt: number; steps: number; files: Set<string>; commands: number };

export const startTally = (now: number): TaskTally => ({ startedAt: now, steps: 0, files: new Set(), commands: 0 });

const CHANGE = /^(Editing|Writing|Deleting) (.+)$/;
const COMMAND = /^Running /;

/** Counts one tool step from the line the pet was given for it. */
export function countStep(tally: TaskTally, label: string): void {
  tally.steps += 1;
  const change = CHANGE.exec(label);
  // "Editing something" is a tool that named no file, so it cannot say which one.
  if (change && change[2] !== 'something') tally.files.add(change[2]);
  if (COMMAND.test(label)) tally.commands += 1;
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** "All done in 4m 12s: 12 steps, 3 files changed, 2 commands run". Nothing is said about zeros. */
export function wrapUp(tally: TaskTally, now: number): string {
  const parts: string[] = [];
  if (tally.steps) parts.push(plural(tally.steps, 'step', 'steps'));
  if (tally.files.size) parts.push(`${plural(tally.files.size, 'file', 'files')} changed`);
  if (tally.commands) parts.push(`${plural(tally.commands, 'command', 'commands')} run`);
  const took = `All done in ${formatElapsed(now - tally.startedAt)}`;
  return parts.length ? `${took}: ${parts.join(', ')}` : took;
}
