import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../.github/workflows/sync-dev.yml', import.meta.url), 'utf8');

function job(name) {
  const match = source.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z-]+:\\n|(?![\\s\\S]))`, 'm'));
  assert.ok(match, `job ${name} exists`);
  return match[1];
}

test('sync-dev runs every two days or on demand and is read-only by default', () => {
  assert.match(source, /schedule:\n\s+- cron: '37 3 \*\/2 \* \*'/);
  assert.match(source, /workflow_dispatch:\n\s+inputs:\n\s+force_verify:[\s\S]*?type: boolean\n\s+default: false/);
  assert.match(source, /\npermissions:\n {2}contents: read\n/);
  assert.deepEqual([...source.matchAll(/^ {2}([a-z-]+):\n {4}name:/gm)].map(m => m[1]), ['merge', 'verify', 'report']);
});

test('sync-dev merge job is the only writer and installs nothing', () => {
  const merge = job('merge');
  assert.match(merge, /permissions:\n\s+contents: write\n\s+issues: write\n/);
  assert.match(merge, /ref: dev\n\s+fetch-depth: 0/);
  assert.match(merge, /pushed: \$\{\{ steps\.merge\.outputs\.pushed \}\}/);
  assert.match(merge, /sha: \$\{\{ steps\.merge\.outputs\.sha \}\}/);
  assert.doesNotMatch(merge, /pnpm|setup-node|npm |cache/);
  assert.equal((source.match(/contents: write/g) ?? []).length, 1);
});

test('sync-dev verify runs lint and typecheck read-only, cache-free, on the pushed dev', () => {
  const verify = job('verify');
  assert.match(verify, /needs: merge/);
  assert.match(verify, /if: needs\.merge\.outputs\.pushed == 'true' \|\| inputs\.force_verify/);
  assert.match(verify, /permissions:\n\s+contents: read\n(?!\s+\w+: )/);
  assert.match(verify, /ref: dev\n\s+fetch-depth: 0\n\s+persist-credentials: false/);
  assert.doesNotMatch(verify, /ref: \$\{\{/);
  assert.match(verify, /git merge-base --is-ancestor "\$PUSHED_SHA" HEAD/);
  assert.match(verify, /dev has moved on since the sync/);
  assert.doesNotMatch(verify, /actions\/cache|\n\s+cache:|: write\b/);
  assert.match(verify, /pnpm install --frozen-lockfile/);
  assert.match(verify, /pnpm lint/);
  assert.match(verify, /pnpm typecheck/);
  assert.match(verify, /GITHUB_STEP_SUMMARY/);
});

test('sync-dev report only files issues for a failed verify and checks out nothing', () => {
  const report = job('report');
  assert.match(report, /needs: \[merge, verify\]/);
  assert.match(report, /if: always\(\) && needs\.verify\.result == 'failure'/);
  assert.match(report, /permissions:\n\s+issues: write\n(?!\s+\w+: )/);
  assert.doesNotMatch(report, /actions\/checkout|setup-node|pnpm\/action-setup|\n\s+run: pnpm|contents:/);
  assert.match(report, /ISSUE_TITLE: dev ← main sync broke lint\/typecheck/);
  assert.match(report, /gh issue list --state open/);
  assert.match(report, /git switch dev && git pull && pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck/);
  assert.match(report, /Never raise the suppression baseline without review/);
});

test('sync-dev merges main with a real merge commit and pushes only dev', () => {
  assert.match(source, /git merge --no-ff --no-commit origin\/main/);
  assert.match(source, /git commit --no-edit --cleanup=strip\n\s+git push origin dev\n/);
  assert.doesNotMatch(source, /--squash|git rebase|--force|\+dev/);
  const pushes = source.match(/^\s*git push .*/gm)?.map(line => line.trim()) ?? [];
  assert.deepEqual(pushes, ['git push origin dev']);
});

test('sync-dev conflicts abort the merge, open or update one issue and fail the job', () => {
  assert.match(source, /git merge --abort/);
  assert.match(source, /git switch dev && git merge --no-ff --no-commit origin\/main/);
  assert.match(source, /gh issue list --state open/);
  assert.match(source, /gh issue create --title "\$ISSUE_TITLE"/);
  assert.match(source, /ISSUE_TITLE: dev ← main sync has conflicts/);
  const report = job('merge').split('- name: Report conflicts\n')[1];
  assert.match(report, /if: steps\.merge\.outputs\.conflicted == 'true'/);
  assert.match(report, /exit 1\s*$/);
});

test('sync-dev merges CHANGELOG.md with main\'s resolver and pushes only a fully merged tree', () => {
  const merge = job('merge');
  // The resolver comes from the workflow's own commit, never from the dev checkout.
  assert.match(merge, /git show "\$GITHUB_SHA:scripts\/merge-changelog\.mjs" > "\$RUNNER_TEMP\/merge-changelog\.mjs"/);
  assert.match(merge, /node "\$RUNNER_TEMP\/merge-changelog\.mjs"/);
  assert.deepEqual(merge.match(/^\s*(?:&& )?node .*/gm)?.map(line => line.trim()), ['&& node "$RUNNER_TEMP/merge-changelog.mjs" 2> changelog-error.txt; then']);
  // It runs whether git conflicted or not, and gates the push.
  assert.match(merge, /--no-commit origin\/main \|\| true\n[\s\S]*merge-changelog[\s\S]*if \[ "\$changelog_merged" = true \] && \[ ! -s conflicts\.txt \]; then\n\s+git commit/);
  assert.match(merge, /if \[ "\$changelog_merged" = false \] && ! grep -qx CHANGELOG\.md conflicts\.txt; then\n\s+echo CHANGELOG\.md >> conflicts\.txt/);
  assert.match(merge, /node scripts\/merge-changelog\.mjs {2}# merges CHANGELOG\.md when it can/);
});
