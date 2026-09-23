/**
 * Fetching the companion so that installing the extension is all anyone has to do.
 *
 * The companion is a Windows application of about 100MB, which is too much to carry
 * inside an extension that is updated often, so it is downloaded once from the release
 * this extension was built against (see release.ts) and kept in the extension's own
 * storage folder. Nothing is installed system-wide and no admin rights are needed.
 *
 * The download is checked against the fingerprint built into the extension before a
 * single byte of it is run. A file that does not match is deleted, never executed.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { get } from 'node:https';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { COMPANION_RELEASE } from './release.js';

const run = promisify(execFile);

/**
 * Windows' own tar, by full path. Plain `tar` can resolve to the one Git for Windows
 * ships, which reads `C:\...` as a remote host and refuses to extract locally.
 */
const windowsTar = (): string => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');

/** Progress for the user, as a message and a fraction of the download that is done. */
export type Report = (message: string, fraction?: number) => void;

export const COMPANION_EXE = 'Bob Pet.exe';
/** Where a downloaded build of a given version lives inside the extension's storage. */
export const companionHome = (storage: string, version: string): string => join(storage, 'companion', version);
export const companionExe = (storage: string, version = COMPANION_RELEASE.version): string =>
  join(companionHome(storage, version), COMPANION_EXE);
/** Whether this build of the extension knows about a companion it can fetch. */
export const canDownload = (): boolean =>
  Boolean(COMPANION_RELEASE.url && COMPANION_RELEASE.sha256 && COMPANION_RELEASE.version);

const MAX_REDIRECTS = 5;

/** Downloads `url` to `file`, returning its SHA-256. Only https, and only so many hops. */
async function fetchTo(url: string, file: string, expectedBytes: number, report: Report): Promise<string> {
  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!target.startsWith('https://')) throw new Error(`refusing to download over ${target.split(':')[0]}`);
    const outcome = await new Promise<{ redirect?: string; sha256?: string }>((resolve, reject) => {
      get(target, (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          resolve({ redirect: new URL(response.headers.location, target).toString() });
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new Error(`the download answered ${status}`));
          return;
        }
        const total = Number(response.headers['content-length']) || expectedBytes;
        const hash = createHash('sha256');
        let received = 0;
        const out = createWriteStream(file);
        const ceiling = expectedBytes > 0 ? expectedBytes * 1.1 : Number.POSITIVE_INFINITY;
        response.on('data', (chunk: Buffer) => {
          hash.update(chunk);
          received += chunk.length;
          // The size is known from the release; anything much larger is not our file.
          if (received > ceiling) {
            response.destroy();
            reject(new Error('the download was larger than the release it claims to be'));
            return;
          }
          if (total > 0) report('Downloading Bob Pet', received / total);
        });
        response.pipe(out);
        out.on('error', reject);
        response.on('error', reject);
        out.on('finish', () => resolve({ sha256: hash.digest('hex') }));
      }).on('error', reject);
    });
    if (outcome.sha256) return outcome.sha256;
    target = outcome.redirect as string;
  }
  throw new Error('the download redirected too many times');
}

/**
 * Makes sure the companion this extension was built against is on disk, downloading it
 * if it is not, and returns the path to it. Throws with a readable reason if it cannot.
 */
export async function ensureDownloadedCompanion(storage: string, report: Report, log: (line: string) => void): Promise<string> {
  if (!canDownload()) throw new Error('this build of the extension has no companion download configured');
  const { version, url, sha256, bytes } = COMPANION_RELEASE;
  const home = companionHome(storage, version);
  const exe = companionExe(storage, version);
  if (await stat(exe).then(() => true, () => false)) return exe;

  const staging = join(storage, `download-${process.pid}`);
  const archive = join(staging, 'companion.zip');
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    log(`Downloading companion ${version} from ${url}`);
    const actual = await fetchTo(url, archive, bytes, report);
    if (actual !== sha256) {
      log(`Rejected download: expected ${sha256}, got ${actual}`);
      throw new Error('the download did not match its fingerprint, so it was discarded');
    }
    report('Unpacking Bob Pet');
    const unpacked = join(staging, 'unpacked');
    await mkdir(unpacked, { recursive: true });
    // tar has shipped with Windows since 10 1803 and reads zip archives.
    await run(windowsTar(), ['-xf', archive, '-C', unpacked]);
    await mkdir(join(storage, 'companion'), { recursive: true });
    await rm(home, { recursive: true, force: true });
    // Both sides live in this storage folder, so this is a rename within one volume.
    await rename(unpacked, home);
    if (!(await stat(exe).then(() => true, () => false))) throw new Error(`the download did not contain ${COMPANION_EXE}`);
    log(`Companion ${version} installed at ${home}`);
    await removeOtherVersions(storage, version, log);
    return exe;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** Clears out companions from earlier extension versions; failures are not worth a fuss. */
async function removeOtherVersions(storage: string, keep: string, log: (line: string) => void): Promise<void> {
  try {
    const root = join(storage, 'companion');
    for (const entry of await readdir(root)) {
      if (entry === keep) continue;
      await rm(join(root, entry), { recursive: true, force: true });
      log(`Removed superseded companion ${entry}`);
    }
  } catch {
    // An old copy left behind costs disk space and nothing else.
  }
}
