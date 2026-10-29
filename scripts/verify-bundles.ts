import * as fs from 'fs';
import assert from 'node:assert/strict';
import * as path from 'path';

import { FIXTURE_FORMAT } from '../tools/host-fixtures/format';

import { assertBackgroundScriptLoading, assertSelfContainedBundles } from './bundle-integrity';
import { assertBundleSizes } from './bundle-size-ratchet';

const roots = process.argv.slice(2);
const dirs = roots.length > 0
  ? roots
  : ['dist/chrome-unpacked', 'dist/firefox-unpacked'];

for (const dir of dirs) {
  const resolved = path.resolve(dir);
  console.log(`Verifying self-contained bundles in ${resolved}`);
  assertSelfContainedBundles(resolved);
  assertBackgroundScriptLoading(resolved);
  // Recorded host fixtures are test data (tools/host-fixtures); none may reach a package.
  for (const file of fs.readdirSync(resolved, { recursive: true, encoding: 'utf8' })) {
    if (!/\.(?:js|json|html)$/.test(file)) continue;
    assert.ok(!fs.readFileSync(path.join(resolved, file), 'utf8').includes(FIXTURE_FORMAT), `${file} contains a recorded host fixture`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(resolved, 'manifest.json'), 'utf8'));
  const settings = manifest.browser_specific_settings;
  if (!settings?.gecko) {
    // The player UI host is a popover (Chromium 114).
    assert.equal(manifest.minimum_chrome_version, '114', 'Chromium minimum must stay 114 for the Popover API');
  } else {
    assert.equal(manifest.minimum_chrome_version, undefined, 'Firefox manifest must not carry minimum_chrome_version');
    assert.equal(settings.gecko.strict_min_version, '140.0', 'Firefox desktop minimum must stay 140.0');
    assert.equal(settings.gecko_android, undefined, 'Firefox for Android is unsupported and must not be declared');
  }
}

// The shared bundles may only shrink; this needs the production build, so it lives here, not in `pnpm check`.
assertBundleSizes(dirs);

console.log('Bundle integrity check passed.');
