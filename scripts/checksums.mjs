import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const distPath = fileURLToPath(new URL('../dist/', import.meta.url));
let entries = [];
try {
  entries = await readdir(distPath);
} catch {
  throw new Error('dist/ does not exist; package the release before generating checksums.');
}

const releaseFiles = entries.filter((name) => /\.(exe|vsix)$/i.test(name));
if (!releaseFiles.length) throw new Error('No installer or VSIX was found in dist/.');

const lines = await Promise.all(
  releaseFiles.sort().map(async (name) => {
    const content = await readFile(join(distPath, name));
    const hash = createHash('sha256').update(content).digest('hex');
    return `${hash}  ${name}`;
  })
);

await writeFile(join(distPath, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
console.log('Generated SHA256SUMS.txt:\n' + lines.join('\n'));
