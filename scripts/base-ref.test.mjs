import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { baseRef } from './base-ref.mjs';

/** A throwaway repo with a `main` history; `run` receives a `git` helper for the rest of the setup. */
function withRepo(run) {
  const cwd = mkdtempSync(join(tmpdir(), 'base-ref-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, stdio: 'pipe' });
  const commit = () => git('commit', '--quiet', '--allow-empty', '-m', 'c');
  try {
    git('init', '--quiet');
    commit();
    run(cwd, git, commit);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('base ref follows the pull request base branch', () => {
  assert.equal(baseRef({ GITHUB_BASE_REF: 'dev' }, tmpdir()), 'origin/dev');
  assert.equal(baseRef({ GITHUB_BASE_REF: 'main' }, tmpdir()), 'origin/main');
  assert.equal(baseRef({ GITHUB_BASE_REF: 'x; rm -rf /' }, tmpdir()), 'origin/main');
});

test('the pull request base wins even when the other branch is closer', () => {
  withRepo((cwd, git, commit) => {
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    commit();
    git('update-ref', 'refs/remotes/origin/dev', 'HEAD');
    assert.equal(baseRef({ GITHUB_BASE_REF: 'main' }, cwd), 'origin/main');
  });
});

test('locally a branch cut from dev compares with origin/dev', () => {
  withRepo((cwd, git, commit) => {
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    commit();
    git('update-ref', 'refs/remotes/origin/dev', 'HEAD');
    commit();
    assert.equal(baseRef({}, cwd), 'origin/dev');
    assert.equal(baseRef({ GITHUB_BASE_REF: '' }, cwd), 'origin/dev');
  });
});

test('locally a branch cut from main compares with origin/main', () => {
  withRepo((cwd, git, commit) => {
    git('update-ref', 'refs/remotes/origin/dev', 'HEAD');
    commit();
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    commit();
    assert.equal(baseRef({}, cwd), 'origin/main');
  });
});

test('a tie keeps origin/main', () => {
  withRepo((cwd, git, commit) => {
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('update-ref', 'refs/remotes/origin/dev', 'HEAD');
    commit();
    assert.equal(baseRef({}, cwd), 'origin/main');
  });
});

test('a missing long-lived ref is ignored, and none at all keeps origin/main', () => {
  withRepo((cwd, git, commit) => {
    assert.equal(baseRef({}, cwd), 'origin/main');
    git('update-ref', 'refs/remotes/origin/dev', 'HEAD');
    commit();
    assert.equal(baseRef({}, cwd), 'origin/dev');
  });
});
