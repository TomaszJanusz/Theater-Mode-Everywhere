import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Release can check out an older tag without our local action. Its inline
// fallback must provide exactly the same Linux audio backend as PR/nightly CI.
test('tag-pinned releases keep virtual audio setup in sync with CI and nightly', () => {
  const action = readFileSync(new URL('../.github/actions/virtual-audio/action.yml', import.meta.url), 'utf8');
  const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const script = action.split('      run: |\n')[1].trim().split('\n').map(line => line.trim()).join('\n');
  const releaseScript = release.split('      - name: Start virtual audio device\n')[1]
    .split('        run: |\n')[1].split('\n\n')[0].trim().split('\n').map(line => line.trim()).join('\n');
  assert.equal(releaseScript, script);
  for (const workflow of ['ci', 'nightly']) {
    const source = readFileSync(new URL(`../.github/workflows/${workflow}.yml`, import.meta.url), 'utf8');
    assert.match(source, /uses: \.\/\.github\/actions\/virtual-audio/);
  }
});

test('nightly runs the unrestricted default suite on main and reports blocking suite/smoke outcomes', () => {
  const source = readFileSync(new URL('../.github/workflows/nightly.yml', import.meta.url), 'utf8');
  const suite = source.split('      - name: Full test suite\n')[1].split('      - name: Smoke Chromium\n')[0];
  assert.match(source, /ref: main\n\s+fetch-depth: 0/);
  assert.match(source, /timeout-minutes: 30/);
  assert.match(suite, /timeout-minutes: (?:2[5-9]|30)\n/);
  assert.match(suite, /run: pnpm test\n/);
  assert.doesNotMatch(source, /THEATER_TEST_ENGINES|--lane|--files-from|continue-on-error/);
  for (const engine of ['chromium', 'firefox']) {
    const smoke = source.split(`        id: ${engine}\n`)[1].split('      - name:')[0];
    assert.match(smoke, /if: \$\{\{ !cancelled\(\) \}\}/);
    assert.ok(smoke.includes(`run: xvfb-run --auto-servernum pnpm smoke:${engine}`));
  }
  assert.match(source, /name: Coverage summary\n\s+if: always\(\)/);
  assert.match(source, /Full suite \(unit \+ Chromium \+ Firefox\): \$TEST_RESULT/);
});
