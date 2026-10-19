import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { assertBackgroundScriptLoading, assertSelfContainedBundles } from './bundle-integrity';

const roots = process.argv.slice(2);
const dirs = roots.length > 0
  ? roots
  : ['dist/chrome-unpacked', 'dist/firefox-unpacked'];

for (const dir of dirs) {
  const resolved = path.resolve(dir);
  console.log(`Verifying self-contained bundles in ${resolved}`);
  assertSelfContainedBundles(resolved);
  assertBackgroundScriptLoading(resolved);
  const manifest = JSON.parse(fs.readFileSync(path.join(resolved, 'manifest.json'), 'utf8'));
  const settings = manifest.browser_specific_settings;
  if (settings?.gecko) {
    assert.equal(settings.gecko.strict_min_version, '140.0', 'Firefox desktop minimum must stay 140.0');
    assert.equal(settings.gecko_android?.strict_min_version, '142.0', 'Firefox for Android requires 142.0 for data collection permissions');
  }
}

console.log('Bundle integrity check passed.');
