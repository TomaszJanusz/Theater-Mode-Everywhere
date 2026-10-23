import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { imageRef, playwrightVersion } from './ci-image.mjs';

const lock = version => `packages:\n\n  playwright-core@${version}:\n    resolution: {}\n\n  playwright@${version}:\n    resolution: {}\n`;

test('reads the single resolved Playwright version, not playwright-core', () => {
  assert.equal(playwrightVersion(lock('1.63.0')), '1.63.0');
});

test('refuses ambiguous or missing versions instead of guessing an image', () => {
  assert.throws(() => playwrightVersion(`${lock('1.63.0')}\n  playwright@1.62.1:\n`), /1\.63\.0, 1\.62\.1/);
  assert.throws(() => playwrightVersion('packages: {}\n'), /none/);
});

test('tag follows Playwright version and Dockerfile content, in a lowercase repository path', () => {
  const a = imageRef('Owner/Repo-Name', '1.63.0', 'FROM x\n');
  assert.match(a.ref, /^ghcr\.io\/owner\/repo-name\/ci-browsers:pw1\.63\.0-[0-9a-f]{12}$/);
  assert.equal(a.base, 'mcr.microsoft.com/playwright:v1.63.0-noble');
  assert.notEqual(a.ref, imageRef('Owner/Repo-Name', '1.63.0', 'FROM y\n').ref);
  assert.notEqual(a.ref, imageRef('Owner/Repo-Name', '1.64.0', 'FROM x\n').ref);
  assert.throws(() => imageRef('owner/repo/../x', '1.63.0', ''), /Invalid repository/);
});

test('the repository lockfile resolves to a Playwright version', () => {
  assert.match(playwrightVersion(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')), /^\d+\.\d+\.\d+$/);
});
