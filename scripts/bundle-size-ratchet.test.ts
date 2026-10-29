import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { assertSizes, baselineFile, compareSizes, lowerBaseline, measureSizes, readBaseline, sizeCells, TOLERANCE_BYTES } from './bundle-size-ratchet';
import { repoWithBase } from './ratchet-base-fixture';
import { assertBaselineRatchet } from './test-determinism';

const baseline = { 'content.js': 700_000, 'mainWorld.js': 200_000 };

describe('bundle size ratchet', () => {
  it('passes at the recorded size and anywhere inside the tolerance', () => {
    assertSizes(baseline, baseline);
    assertSizes({ 'content.js': 700_000 + TOLERANCE_BYTES, 'mainWorld.js': 200_000 - TOLERANCE_BYTES }, baseline);
  });

  it('fails one byte past the tolerance, per bundle', () => {
    assert.throws(() => assertSizes({ ...baseline, 'content.js': 700_000 + TOLERANCE_BYTES + 1 }, baseline), /content\.js grew by 1025 B/);
    assert.throws(() => assertSizes({ ...baseline, 'mainWorld.js': 201_500 }, baseline), /mainWorld\.js grew by 1500 B/);
  });

  it('does not let a shrinking bundle pay for a growing one', () => {
    const { grown } = compareSizes({ 'content.js': 690_000, 'mainWorld.js': 205_000 }, baseline);
    assert.equal(grown.length, 1);
    assert.match(grown[0], /mainWorld\.js/);
  });

  it('does not let small growths accumulate: the record is not raised by them', () => {
    const afterFirst = { ...baseline, 'content.js': 700_900 };
    assertSizes(afterFirst, baseline);
    assert.throws(() => assertSizes({ ...afterFirst, 'content.js': 701_800 }, baseline), /grew by 1800 B/);
    assert.deepEqual(lowerBaseline(afterFirst, baseline), baseline);
  });

  it('requires a real improvement to be locked in, and --update only lowers the record', () => {
    const smaller = { 'content.js': 650_000, 'mainWorld.js': 200_000 };
    assert.throws(() => assertSizes(smaller, baseline), /content\.js shrank by 50000 B[\s\S]*--update/);
    assertSizes(smaller, baseline, { allowImprovement: true });
    assert.deepEqual(lowerBaseline(smaller, baseline), smaller);
    assert.deepEqual(lowerBaseline({ 'content.js': 800_000, 'mainWorld.js': 150_000 }, baseline), { 'content.js': 700_000, 'mainWorld.js': 150_000 });
  });

  it('measures the shipped files and validates the baseline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-size-'));
    try {
      mkdirSync(join(dir, 'x'));
      writeFileSync(join(dir, 'content.js'), 'a'.repeat(10));
      writeFileSync(join(dir, 'mainWorld.js'), 'b'.repeat(4));
      assert.deepEqual(measureSizes(dir), { 'content.js': 10, 'mainWorld.js': 4 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    assert.throws(() => readBaseline('{"content.js":1}'), /exactly/);
    assert.throws(() => readBaseline('{"content.js":0,"mainWorld.js":1}'), /positive integer/);
    assert.deepEqual(readBaseline('{"content.js":2,"mainWorld.js":1}'), { 'content.js': 2, 'mainWorld.js': 1 });
  });
});

describe('the base branch comparison', () => {
  const base = { 'content.js': 700_000, 'mainWorld.js': 200_000 };

  it('rejects a build past the base record plus tolerance even when the baseline was raised to match', () => {
    const raised = { ...base, 'content.js': 720_000 };
    const directory = repoWithBase(baselineFile.path, JSON.stringify(base), JSON.stringify(raised));
    try {
      // This branch's baseline matches the build, so only the base reveals the growth.
      assertSizes(raised, raised);
      assert.throws(() => assertBaselineRatchet(sizeCells(raised), directory, true, baselineFile), /content\.js: bytes grew from 701024 to 720000; move the code into the provider/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('accepts the base size, growth inside the tolerance and any shrink', () => {
    const directory = repoWithBase(baselineFile.path, JSON.stringify(base), JSON.stringify(base));
    try {
      assertBaselineRatchet(sizeCells(base), directory, true, baselineFile);
      assertBaselineRatchet(sizeCells({ ...base, 'content.js': 700_000 + TOLERANCE_BYTES }), directory, true, baselineFile);
      assertBaselineRatchet(sizeCells({ ...base, 'mainWorld.js': 150_000 }), directory, true, baselineFile);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
