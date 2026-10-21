import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { nextVolumeLevel, stopAtFullVolume, volumePercent } from './volume-level';

describe('nextVolumeLevel', () => {
  it('steps by 5% from any starting level', () => {
    assert.equal(nextVolumeLevel(0.72, 'up', 1), 0.77);
    assert.equal(nextVolumeLevel(0.72, 'down', 1), 0.67);
    assert.equal(nextVolumeLevel(0, 'up', 1), 0.05);
    assert.equal(nextVolumeLevel(0.02, 'down', 1), 0);
  });

  it('lands on 100% before anything above it', () => {
    for (const from of [0.95, 0.9500000001, 0.96, 0.99, 0.99999]) {
      assert.equal(nextVolumeLevel(from, 'up', 1.5), 1, `from ${from}`);
    }
    assert.equal(nextVolumeLevel(0.95 + Number.EPSILON, 'up', 1.5), 1);
    assert.equal(nextVolumeLevel(1, 'up', 1.5), 1.05);
    assert.equal(nextVolumeLevel(1.0000000001, 'up', 1.5), 1.05);
    assert.equal(nextVolumeLevel(0.9999999999, 'up', 1.5), 1.05);
  });

  it('never exceeds the ceiling, and stays at 100% without boost', () => {
    assert.equal(nextVolumeLevel(0.99, 'up', 1), 1);
    assert.equal(nextVolumeLevel(1, 'up', 1), 1);
    assert.equal(nextVolumeLevel(1.48, 'up', 1.5), 1.5);
    assert.equal(nextVolumeLevel(1.5, 'up', 1.5), 1.5);
    assert.equal(nextVolumeLevel(1.3, 'up', 1), 1, 'a lowered ceiling pulls the level back');
  });

  it('stops at 100% on the way down as well', () => {
    assert.equal(nextVolumeLevel(1.05, 'down', 1.5), 1);
    assert.equal(nextVolumeLevel(1.02, 'down', 1.5), 1);
    assert.equal(nextVolumeLevel(1.0000000001, 'down', 1.5), 0.95, 'drift around 1 counts as 100%');
    assert.equal(nextVolumeLevel(1, 'down', 1.5), 0.95);
    assert.equal(nextVolumeLevel(1.5, 'down', 1.5), 1.45);
  });

  it('walks 0 to ceiling and back through each stop', () => {
    let level = 0;
    const up: number[] = [];
    while (level < 1.1) { level = nextVolumeLevel(level, 'up', 1.1); up.push(level); }
    assert.equal(up.length, 22);
    assert.deepEqual(up.slice(18), [0.95, 1, 1.05, 1.1]);
    assert.deepEqual([1.1, 1.05, 1, 0.95].map(l => nextVolumeLevel(l, 'down', 1.1)), [1.05, 1, 0.95, 0.9]);
  });
});

describe('stopAtFullVolume', () => {
  it('clamps a jump across 100% (a fast drag) and leaves other moves alone', () => {
    assert.equal(stopAtFullVolume(0.9, 1.2), 1);
    assert.equal(stopAtFullVolume(1.3, 0.8), 1);
    assert.equal(stopAtFullVolume(0.9, 0.95), 0.95);
    assert.equal(stopAtFullVolume(1, 1.2), 1.2);
    assert.equal(stopAtFullVolume(1, 0.7), 0.7);
    assert.equal(stopAtFullVolume(1.2, 1.4), 1.4);
  });
});

describe('volumePercent', () => {
  it('shows the level directly up to 100% and 400% per level above it', () => {
    assert.equal(volumePercent(0), 0);
    assert.equal(volumePercent(0.72), 72);
    assert.equal(volumePercent(1), 100);
    assert.equal(volumePercent(1.05), 120);
    assert.equal(volumePercent(1.25), 200);
    assert.equal(volumePercent(1.5), 300);
  });
});
