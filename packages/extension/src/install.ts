/**
 * Finding the pet that ships inside this extension, and on macOS unpacking it first.
 *
 * Windows carries the pet as ordinary files, so there is nothing to do. macOS carries it
 * as a tar archive: a `.app` is a tree of symlinks and executable files, and the editor
 * unpacks a VSIX without preserving either, which leaves an application that cannot run.
 * Unpacking the archive ourselves keeps both, and tar is present on every macOS install.
 *
 * The unpacked copy lives in the extension's own storage, once per version, and is reused
 * after that. Nothing is downloaded at any point.
 */
import { execFile } from 'node:child_process';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** What the executable is called inside each platform's build. */
export const COMPANION_EXE = 'Bob Pet.exe';
export const MAC_APP = 'Bob Pet.app';
export const MAC_ARCHIVE = 'companion-mac.tar.gz';
/** Inside the bundle, macOS puts the real binary here. */
export const macBinary = (appDir: string): string => join(appDir, MAC_APP, 'Contents', 'MacOS', 'Bob Pet');

/**
 * Returns the pet's executable for this platform, unpacking it on macOS the first time.
 *
 * `storage` is the extension's own storage folder, and `version` keys the unpacked copy so
 * an update never runs the previous version's app.
 */
export async function ensureCompanion(
  extensionRoot: string,
  storage: string,
  version: string,
  log: (line: string) => void,
  platform: NodeJS.Platform = process.platform
): Promise<string | undefined> {
  const bundled = join(extensionRoot, 'companion');
  if (platform === 'win32') {
    const exe = join(bundled, COMPANION_EXE);
    return (await exists(exe)) ? exe : undefined;
  }
  if (platform !== 'darwin') return undefined;

  const home = join(storage, 'companion', version);
  const binary = macBinary(home);
  if (await exists(binary)) return binary;

  const archive = join(bundled, MAC_ARCHIVE);
  if (!(await exists(archive))) return undefined;

  log(`Unpacking the pet for macOS into ${home}`);
  // Extracted beside the destination and renamed into place: two editor windows activate
  // at once, and extracting over a shared folder means one deletes the other's half-done
  // tree. A rename is atomic, so the loser simply finds the winner's copy already there.
  const staging = `${home}.${process.pid}.tmp`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    await run('/usr/bin/tar', ['-xzf', archive, '-C', staging]);
    if (!(await exists(macBinary(staging)))) {
      log(`Unpacked ${archive} but found no ${MAC_APP} inside it`);
      return undefined;
    }
    await mkdir(join(storage, 'companion'), { recursive: true });
    await rename(staging, home).catch(async (error: NodeJS.ErrnoException) => {
      // Someone else got there first, which is fine: their copy is as good as ours.
      if (!(await exists(binary))) throw error;
    });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  if (!(await exists(binary))) return undefined;
  log(`The pet is ready at ${binary}`);
  await removeOtherVersions(storage, version, log);
  return binary;
}

/** Clears out the copies left by earlier versions; each one is a few hundred megabytes. */
async function removeOtherVersions(storage: string, keep: string, log: (line: string) => void): Promise<void> {
  try {
    const root = join(storage, 'companion');
    for (const entry of await readdir(root)) {
      if (entry === keep || entry.endsWith('.tmp')) continue;
      await rm(join(root, entry), { recursive: true, force: true });
      log(`Removed the copy left by version ${entry}`);
    }
  } catch {
    // An old copy left behind costs disk space and nothing else.
  }
}

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false);
