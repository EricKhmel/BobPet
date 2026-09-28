/**
 * Puts the built companion inside the extension, so the VSIX carries the pet itself.
 *
 * Windows ships the unpacked folder as-is. macOS cannot: a `.app` is full of symlinks and
 * files that must stay executable, and a VSIX is a zip that the editor unpacks without
 * preserving either - the result is an application that will not start. So macOS ships a
 * tar archive instead, which keeps both, and the extension unpacks it once on first run.
 *
 *   node scripts/bundle-companion.mjs            # for the platform being built
 *   node scripts/bundle-companion.mjs darwin-arm64
 */
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'packages', 'extension', 'companion');

/** Where electron-builder leaves each platform's unpacked build. */
const BUILDS = {
  'win32-x64': { dir: 'win-unpacked', proof: 'Bob Pet.exe' },
  'darwin-arm64': { dir: 'mac-arm64', proof: 'Bob Pet.app' },
  'darwin-x64': { dir: 'mac', proof: 'Bob Pet.app' },
  'linux-x64': { dir: 'linux-unpacked', proof: 'bob-pet' }
};

const requested = process.argv[2] ?? `${process.platform}-${process.arch}`;
const build = BUILDS[requested];
if (!build) {
  console.error(`No build layout known for ${requested}. Expected one of: ${Object.keys(BUILDS).join(', ')}`);
  process.exit(1);
}

const source = join(root, 'dist', build.dir);
if (!(await stat(join(source, build.proof)).then(() => true, () => false))) {
  console.error(`No companion at ${join(source, build.proof)}. Build and package the companion for ${requested} first.`);
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });

if (requested.startsWith('darwin')) {
  // -C so the archive holds "Bob Pet.app" at its root, with symlinks and modes intact.
  await run('tar', ['-czf', join(target, 'companion-mac.tar.gz'), '-C', source, build.proof]);
  console.log(`Bundled ${build.proof} from ${source} as a tar archive (unpacked by the extension on first run)`);
} else {
  await cp(source, target, { recursive: true });
  console.log(`Bundled the companion from ${source}`);
}
