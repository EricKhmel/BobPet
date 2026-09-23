/**
 * Writes the companion release the extension will download into its source, from the zip
 * that was just built. Run by the release workflow before the VSIX is packaged, so the
 * fingerprint the extension checks against is taken from the exact file being published.
 *
 *   node scripts/stamp-release.mjs <zip> <download url>
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [zip, url] = process.argv.slice(2);
if (!zip || !url) {
  console.error('usage: node scripts/stamp-release.mjs <zip> <download url>');
  process.exit(1);
}
if (!url.startsWith('https://')) {
  console.error('the download url must be https');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'apps', 'companion', 'package.json'), 'utf8')).version;
const bytes = statSync(zip).size;
const sha256 = createHash('sha256').update(readFileSync(zip)).digest('hex');

const target = join(root, 'packages', 'extension', 'src', 'release.ts');
const source = readFileSync(target, 'utf8');
const stamped = source.replace(
  /export const COMPANION_RELEASE = \{[\s\S]*?\};/,
  `export const COMPANION_RELEASE = {\n  version: '${version}',\n  url: '${url}',\n  sha256: '${sha256}',\n  bytes: ${bytes}\n};`
);
if (stamped === source) {
  console.error(`could not find COMPANION_RELEASE in ${target}`);
  process.exit(1);
}
writeFileSync(target, stamped);
console.log(`Stamped companion ${version}: ${bytes} bytes, sha256 ${sha256}`);
