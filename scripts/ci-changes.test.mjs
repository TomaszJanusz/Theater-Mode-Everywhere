import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checksForEvent, shouldRunChecks, shouldRunFirefox } from './ci-changes.mjs';

for (const files of [['README.md'], ['docs/browser-tests.md', 'docs/notes.md'], ['AGENTS.md', 'CLAUDE.md'],
  ['.coderabbit.yaml', '.github/pull_request_template.md', '.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/config.yml']]) {
  test(`skips prose: ${files.join(', ')}`, () => assert.equal(shouldRunChecks(files), false));
}
for (const file of [
  'src/content.ts', '.github/workflows/ci.yml', '.github/codeql/codeql-config.yml',
  'config/eslint.config.mjs', 'config/eslint-rules/max-symbol-name-length.mjs', 'eslint-suppressions.json',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'manifest.json',
  'store-listings/amo/en.md', 'store-listings/assets/cws-promo/README.md',
  '_locales/en/messages.json', 'CHANGELOG.md', 'PRIVACY.md', 'LICENSE',
  'docs/building.md', 'docs/prototype.mjs', 'test/fixtures/vod.md',
  'scripts/ci-changes.mjs', '.github/ISSUE_TEMPLATE/translation-issue.yml', '.github/CODEOWNERS', 'UNKNOWN.md', 'docs/../src/code.md', '',
]) {
  test(`runs for input or unknown: ${file}`, () => assert.equal(shouldRunChecks([file]), true));
  test(`runs mixed README and ${file}`, () => assert.equal(shouldRunChecks(['README.md', file]), true));
}
test('empty or invalid file lists run', () => {
  for (const files of [[], undefined, null, [null]]) assert.equal(shouldRunChecks(files), true);
});
const base = 'a'.repeat(40);
const event = { pull_request: { base: { sha: base } } };
test('PR diff uses merge base, NUL delimiters, and both sides of renames', () => {
  const git = (command, args) => {
    assert.equal(command, 'git');
    assert.deepEqual(args, ['diff', '--name-only', '--no-renames', '-z', `${base}...HEAD`, '--']);
    return 'README.md\0docs/browser-tests.md\0';
  };
  assert.equal(checksForEvent('pull_request', event, git), false);
  assert.equal(checksForEvent('pull_request', event, () => 'src/code.ts\0docs/code.md\0'), true);
});
test('pushes, schedules, missing metadata, empty/malformed diffs and git errors run', () => {
  const docs = () => 'README.md\0';
  for (const name of ['push', 'schedule', undefined]) assert.equal(checksForEvent(name, event, docs), true);
  for (const invalid of [{}, null, { pull_request: { base: { sha: '--invalid' } } }]) {
    assert.equal(checksForEvent('pull_request', invalid, docs), true);
  }
  for (const diff of ['', 'README.md', '\0']) assert.equal(checksForEvent('pull_request', event, () => diff), true);
  assert.equal(checksForEvent('pull_request', event, () => { throw new Error('missing base'); }), true);
});

for (const file of ['manifest.json', 'scripts/build.ts', 'scripts/package-firefox.ts',
  'src/entries/content-start.ts', 'src/providers/soop/provider.json', 'src/providers/provider-api.ts',
  'src/providers/runtime-registration.ts', 'src/providers/catalog.ts', 'src/providers/descriptor-hosts.ts',
  'src/platform/audio.ts', 'src/protocol/messages.ts', 'src/test-utils/test-engines.ts',
  'test/fixtures/player.html', '.github/actions/virtual-audio/action.yml', '.github/ci-image/Dockerfile', '.github/workflows/ci.yml',
  'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json']) {
  test(`Firefox matrix for ${file}`, () => assert.equal(shouldRunFirefox([file]), true));
}
for (const file of ['src/ui/controls.ts', 'options/rte-settings.browser.test.ts',
  'src/providers/youtube/queue.ts', 'README.md', 'docs/browser-tests.md']) {
  test(`Chromium-only PR for ${file}`, () => assert.equal(shouldRunFirefox([file]), false));
}
test('Firefox classification fails open and includes the old side of moved boundaries', () => {
  for (const files of [[], undefined, [null], [''], ['docs/../src/platform/a.ts']]) {
    assert.equal(shouldRunFirefox(files), true);
  }
  assert.equal(checksForEvent('pull_request', event, () => 'src/platform/a.ts\0docs/a.md\0', shouldRunFirefox), true);
  assert.equal(checksForEvent('pull_request', event, () => 'src/ui/a.ts\0', shouldRunFirefox), false);
  assert.equal(checksForEvent('pull_request', event, () => { throw new Error('missing'); }, shouldRunFirefox), true);
});
