import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { STILL_RUNNING_MS } from '@bob-pet/shared';

/**
 * Whether IBM Bob is waiting on the user to approve a tool call.
 *
 * Bob records every approval request it raises in `task_pending_approvals` in its own
 * database and deletes the row the moment the user answers, so a row is an exact signal.
 * Hooks cannot carry it: PreToolUse fires before the approval gate, and a slow tool is
 * silent in exactly the same way as a blocked one.
 *
 * The table is an undocumented internal, so it is read defensively - read-only, one short
 * query per poll with nothing held open in between, and every failure (no database, a
 * renamed table, a locked file) meaning "unknown", which the pet treats as "say nothing".
 */
export const bobDatabasePath = (home = homedir()): string => join(home, '.bob', 'db', 'bob.db');

/**
 * Requests raised at or after `since` (epoch ms, as Bob stamps them). Earlier rows are
 * left behind by sessions that ended without an answer and must never read as a request
 * waiting now. Undefined when the answer cannot be known.
 */
export function pendingApprovalsSince(file: string, since: number): number | undefined {
  if (!existsSync(file)) return undefined;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const row = db.prepare('SELECT COUNT(*) AS n FROM task_pending_approvals WHERE created_at >= ?').get(since) as { n?: number | bigint } | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return undefined;
  } finally {
    try { db?.close(); } catch { /* already closed or never opened */ }
  }
}

/** Time a step runs before the pet notes that it is still going. */
export { STILL_RUNNING_MS };

/**
 * The bubble line for a step in flight. Only a pending request Bob has actually recorded
 * earns "needs your OK"; elapsed time alone earns no more than "still going".
 */
export function stepLine(label: string, elapsedMs: number, pending: number | undefined): string {
  if (pending !== undefined && pending > 0) return `Bob needs your OK — ${label}`;
  if (elapsedMs >= STILL_RUNNING_MS) return `Still going — ${label}`;
  return label;
}
