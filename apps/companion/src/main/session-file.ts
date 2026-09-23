import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type SessionHandle = { port: number; secret: string };

export const sessionFilePath = (userData: string): string => join(userData, 'session.json');

/**
 * Publishes the loopback port and this launch's secret for the hook command.
 *
 * IBM Bob spawns each hook as a short-lived process, so it cannot be handed the secret
 * in memory the way the extension is. The file is written inside the companion's own
 * user-data directory with owner-only permissions, holds a secret that is regenerated
 * every launch, and is removed on quit. A process already running as this user could
 * read it - but such a process could equally read the extension's memory or drive the
 * pet directly, so it is not a new boundary.
 */
export async function writeSessionFile(userData: string, handle: SessionHandle): Promise<void> {
  await mkdir(userData, { recursive: true });
  // `mode` is honoured on POSIX. On Windows it only sets the read-only bit, so what keeps
  // this file to its owner there is the per-user ACL on %APPDATA%, not this argument.
  await writeFile(sessionFilePath(userData), JSON.stringify(handle), { encoding: 'utf8', mode: 0o600 });
}

/**
 * Removes the file only when it is still this instance's.
 *
 * Restarting the pet overlaps two processes: the new one publishes its port and secret
 * while the old one is still shutting down. An unconditional delete on quit would take
 * the new instance's file with it, leaving hooks with nothing to connect to and a pet
 * that silently never reacts.
 */
export async function removeSessionFile(userData: string, secret: string): Promise<void> {
  const path = sessionFilePath(userData);
  try {
    const current = JSON.parse(await readFile(path, 'utf8')) as { secret?: unknown };
    if (current.secret !== secret) return;
  } catch {
    return;
  }
  await rm(path, { force: true });
}
