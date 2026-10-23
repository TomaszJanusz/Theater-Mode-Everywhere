import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import stylelint from 'stylelint';

import { assertNoGrowth, readBaseline } from './stylelint-ratchet.mjs';

test('CSS allowances can only move down and must be lowered when improved', () => {
  const baseline = readBaseline('{"src/ui/shadow.css":{"declaration-no-important":2}}');
  assert.doesNotThrow(() => assertNoGrowth({ 'src/ui/shadow.css': { 'declaration-no-important': 2 } }, baseline));
  assert.throws(() => assertNoGrowth({ 'src/ui/shadow.css': { 'declaration-no-important': 3 } }, baseline), /grew/);
  assert.throws(() => assertNoGrowth({ 'src/ui/shadow.css': { 'selector-disallowed-list': 1 } }, baseline), /grew/);
  assert.throws(() => assertNoGrowth({ 'src/ui/new.css': { 'declaration-no-important': 1 } }, baseline), /grew/);
  assert.throws(() => assertNoGrowth({ 'src/ui/shadow.css': { 'declaration-no-important': 1 } }, baseline), /dropped.*--update/s);
  assert.throws(() => assertNoGrowth({}, baseline), /dropped/);
  assert.doesNotThrow(() => assertNoGrowth({ 'src/ui/shadow.css': { 'declaration-no-important': 1 } }, baseline, { allowImprovement: true }));
});

test('host-specific selectors are rejected however they are written', async () => {
  const configFile = resolve('config/stylelint.config.mjs');
  const flagged = async selector => {
    const { results } = await stylelint.lint({ code: `${selector} { color: red; }`, configFile });
    return results[0].warnings.some(warning => warning.rule === 'selector-disallowed-list');
  };
  for (const selector of ['.ytp-chrome', '#ytd-app', 'ytd-watch-flexy', 'div.ytp-x', '.a.ytp-x', '.a > div.netflix-player', '[class*="ytp-"]', '[class^=twitch-]', ':is(.x, .disney-y)']) {
    assert.equal(await flagged(selector), true, selector);
  }
  for (const selector of ['.tme-controls', '.my-ytp', 'div.player > .controls', '[data-theater="on"]']) {
    assert.equal(await flagged(selector), false, selector);
  }
});
