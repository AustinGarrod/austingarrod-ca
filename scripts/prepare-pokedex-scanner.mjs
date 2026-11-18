import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const target = path.join(root, 'public/utilities/pokedex-binder/scanner-assets/v1');
const sources = [
  ['tesseract.js', '7.0.0', ['dist/worker.min.js', 'LICENSE.md', 'dist/worker.min.js.LICENSE.txt']],
  ['tesseract.js-core', '7.0.0', ['LICENSE', ...['', '-simd', '-relaxedsimd'].map(variant => `tesseract-core${variant}-lstm.wasm.js`)]],
  ['@tesseract.js-data/eng', '1.0.0', ['4.0.0_best_int/eng.traineddata.gz', 'README.md']],
];
await mkdir(target, { recursive: true });
const files = {};
for (const [name, version, paths] of sources) {
  const directory = path.join(root, 'node_modules', name);
  const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  if (metadata.version !== version) throw new Error(`Review scanner dependency version: ${name}`);
  for (const relative of paths) {
    const filename = relative.startsWith('LICENSE') ? `${name.replaceAll('/', '-')}-LICENSE.txt` : path.basename(relative);
    const source = path.join(directory, relative), bytes = await readFile(source);
    await copyFile(source, path.join(target, filename));
    files[filename] = { package: name, version, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  }
}
await writeFile(path.join(target, 'assets.json'), JSON.stringify({ schemaVersion: 1, files }, null, 2) + '\n');
await writeFile(path.join(target, 'ATTRIBUTION.txt'),
  'On-device OCR: Tesseract.js and Tesseract.js-core 7.0.0 (Apache-2.0).\n'
  + 'English model: @tesseract.js-data/eng 1.0.0, 4.0.0_best_int (package metadata: MIT; Tesseract trained models: Apache-2.0).\n'
  + 'Sources: https://github.com/naptha/tesseract.js, https://github.com/naptha/tesseract.js-core, https://github.com/naptha/tessdata, https://github.com/tesseract-ocr/tessdata_best.\n'
  + 'Unmodified upstream worker dependency notices and Apache license texts accompany these files. Assets derive from package-lock.json; images are never part of this cache.\n');
console.log('Prepared pinned, same-origin OCR worker, three LSTM core variants, English model and notices.');
