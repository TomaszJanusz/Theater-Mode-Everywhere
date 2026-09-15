import * as path from 'path';
import { assertSelfContainedBundles } from './bundle-integrity';

const roots = process.argv.slice(2);
const dirs = roots.length > 0
  ? roots
  : ['dist/chrome-unpacked', 'dist/firefox-unpacked'];

for (const dir of dirs) {
  const resolved = path.resolve(dir);
  console.log(`Verifying self-contained bundles in ${resolved}`);
  assertSelfContainedBundles(resolved);
}

console.log('Bundle integrity check passed.');
