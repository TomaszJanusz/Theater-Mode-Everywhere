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
