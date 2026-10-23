import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The self-repository action reference resolves at the workflow commit even
// when release checks out an older tag that lacks the action.
test('CI and tag-pinned releases use the shared audio setup', () => {
  const action = readFileSync(new URL('../.github/actions/virtual-audio/action.yml', import.meta.url), 'utf8');
  const setup = readFileSync(new URL('../.github/actions/setup/action.yml', import.meta.url), 'utf8');
  const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const script = action.split('      run: |\n')[1].trim().split('\n').map(line => line.trim()).join('\n');
  const setupScript = setup.split('    - name: Start virtual audio device\n')[1]
    .split('      run: |\n')[1].trim().split('\n').map(line => line.trim()).join('\n');
  assert.equal(setupScript, script);
  assert.match(release, /uses: \$\/\.github\/actions\/setup/);
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(ci, /uses: \$\/\.github\/actions\/setup/);
  const nightly = readFileSync(new URL('../.github/workflows/nightly.yml', import.meta.url), 'utf8');
  assert.match(nightly, /uses: \.\/\.github\/actions\/virtual-audio/);
});

test('nightly runs the unrestricted default suite on main and dev and reports blocking suite/smoke outcomes', () => {
  const source = readFileSync(new URL('../.github/workflows/nightly.yml', import.meta.url), 'utf8');
  const suite = source.split('      - name: Full test suite\n')[1].split('      - name: Smoke Chromium\n')[0];
  assert.doesNotMatch(source, /matrix|\$\{\{ *(?:github\.(?:event|head_ref|ref)|inputs)/);
  for (const ref of ['main', 'dev']) {
    const job = source.split(`  nightly-${ref}:\n`)[1].split(/\n  nightly-/)[0];
    assert.ok(job.includes(`name: Nightly on ${ref}\n`));
    assert.ok(job.includes(`ref: ${ref}\n          fetch-depth: 0`));
    assert.ok(job.includes(`NIGHTLY_REF: ${ref}\n`));
    // dev code must never read or write the default branch's caches.
    assert.equal(/cache: 'pnpm'|actions\/cache@/.test(job), ref === 'main');
  }
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
