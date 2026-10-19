import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../.github/workflows/sync-dev.yml', import.meta.url), 'utf8');

test('sync-dev runs every two days or on demand with write access', () => {
  assert.match(source, /schedule:\n\s+- cron: '37 3 \*\/2 \* \*'/);
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /permissions:\n\s+contents: write/);
  assert.match(source, /ref: dev\n\s+fetch-depth: 0/);
});

test('sync-dev merges main with a real merge commit and pushes only dev', () => {
  assert.match(source, /git merge --no-ff --no-edit origin\/main/);
  assert.doesNotMatch(source, /--squash|git rebase|--force|\+dev/);
  const pushes = source.match(/^\s*git push .*/gm)?.map(line => line.trim()) ?? [];
  assert.deepEqual(pushes, ['git push origin dev']);
});

test('sync-dev conflicts abort the merge, open or update one issue and fail the job', () => {
  assert.match(source, /git merge --abort/);
  assert.match(source, /git switch dev && git merge origin\/main/);
  assert.match(source, /gh issue list --state open/);
  assert.match(source, /gh issue create --title "\$ISSUE_TITLE"/);
  assert.match(source, /ISSUE_TITLE: dev ← main sync has conflicts/);
  const report = source.split('- name: Report conflicts\n')[1];
  assert.match(report, /if: steps\.merge\.outputs\.conflicted == 'true'/);
  assert.match(report, /exit 1\s*$/);
});
