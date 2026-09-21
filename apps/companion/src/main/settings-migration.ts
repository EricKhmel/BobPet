import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Moves settings from a previous user-data directory to the current one.
 *
 * Electron derives `userData` from the application name, and the companion never set
 * one, so the name fell back to the package name and settings landed in
 * `%APPDATA%\@bob-pet\companion`. Naming the app moves that to `%APPDATA%\Bob Pet`,
 * which would otherwise orphan an existing configuration.
 *
 * Deliberately conservative: it never overwrites a configuration that already exists at
 * the current path, and it leaves an unreadable or malformed legacy file alone so the
 * app falls back to defaults rather than carrying corruption forward. It removes only
 * the legacy settings file it just copied, not the surrounding directory, which also
 * holds Electron's own regenerable caches.
 */
export async function migrateSettingsFile(current: string, legacy: string): Promise<boolean> {
  if (current === legacy) return false;

  try {
    await access(current);
    return false;
  } catch {
    // Nothing at the current path yet, so a legacy file is worth adopting.
  }

  let raw: string;
  try {
    raw = await readFile(legacy, 'utf8');
  } catch {
    return false;
  }

  try {
    JSON.parse(raw);
  } catch {
    return false;
  }

  await mkdir(dirname(current), { recursive: true });
  await writeFile(current, raw, { encoding: 'utf8', mode: 0o600 });
  await rm(legacy, { force: true });
  return true;
}
