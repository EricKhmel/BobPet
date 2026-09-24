/**
 * Copies the built companion into the extension so it ships inside the VSIX.
 *
 * The extension used to download it from a public release; carrying it means there is
 * nothing public to host and nothing to fetch at runtime. Run by the extension's package
 * script, after the companion has been built.
 */
import { cp, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'dist', 'win-unpacked');
const target = join(root, 'packages', 'extension', 'companion');

const built = await stat(join(source, 'Bob Pet.exe')).then(() => true, () => false);
if (!built) {
  console.error(`No companion at ${source}. Run "npm run build --workspace=@bob-pet/companion" and package it first.`);
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
console.log(`Bundled the companion from ${source}`);
