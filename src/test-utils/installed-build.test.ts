import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { installedBuildReady } from './installed-build';

function build(t: { after(fn: () => void): void }, files: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'te-installed-build-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const file of files) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), '');
  }
  return dir;
}

test('a complete build is ready in and out of CI', t => {
  const dir = build(t, ['manifest.json', 'content.js', 'mainWorld.js']);
  const skipped: string[] = [];
  for (const env of [{}, { CI: 'true' }, { GITHUB_ACTIONS: 'true' }]) {
    assert.equal(installedBuildReady({ skip: m => skipped.push(m) }, ['manifest.json', 'content.js', 'mainWorld.js'], env, dir), true);
  }
  assert.deepEqual(skipped, []);
});

test('a missing build skips locally and names the command that makes it', t => {
  const dir = build(t, ['manifest.json']);
  const skipped: string[] = [];
  assert.equal(installedBuildReady({ skip: m => skipped.push(m) }, ['manifest.json', 'content.js'], {}, dir), false);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0], /content\.js.*pnpm build/);
});

test('a missing build fails in CI instead of skipping', t => {
  const dir = build(t, []);
  for (const env of [{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }]) {
    assert.throws(() => installedBuildReady({ skip: () => assert.fail('skipped in CI') }, ['manifest.json'], env, dir), /extension-build artifact/);
  }
});
