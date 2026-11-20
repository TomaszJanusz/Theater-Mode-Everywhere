import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { heightFromLabel, normalizeVideoQuality } from './video-quality-bridge';

const level = (id: string, height: number, label = `${height}p`) => ({ id, label, height });

describe('video quality normalization', () => {
  it('reads the height a host label starts with', () => {
    assert.equal(heightFromLabel('1080p60 HDR'), 1080);
    assert.equal(heightFromLabel(' 720p '), 720);
    assert.equal(heightFromLabel('2160p60'), 2160);
    assert.equal(heightFromLabel('Auto'), null);
    assert.equal(heightFromLabel('p1080'), null);
    assert.equal(heightFromLabel('12p'), null);
  });

  it('orders levels highest first and keeps fixed and playing only when listed', () => {
    assert.deepEqual(normalizeVideoQuality({
      mediaId: 'item', levels: [level('b', 480), level('a', 1080, '  1080p60 '), level('c', 720)], fixed: 'c', playing: 'gone'
    }), { mediaId: 'item', levels: [level('a', 1080, '1080p60'), level('c', 720), level('b', 480)], fixed: 'c', playing: null });
  });

  it('drops duplicate ids and empty labels, keeping the first offer of each level', () => {
    const state = normalizeVideoQuality({
      mediaId: 'item', levels: [level('hd1080', 1080, '1080p60'), level('hd1080', 1080, '1080p Premium'), level('x', 900, '  '), level('large', 480)]
    });
    assert.deepEqual(state?.levels.map(entry => entry.label), ['1080p60', '480p']);
    assert.equal(state?.fixed, null);
  });

  it('offers no choice for fewer than two levels', () => {
    assert.equal(normalizeVideoQuality({ mediaId: 'item', levels: [level('a', 720)] }), null);
    assert.equal(normalizeVideoQuality({ mediaId: 'item', levels: [level('a', 720), level('a', 720)] }), null);
  });

  it('rejects malformed or oversized descriptions as a whole', () => {
    const two = [level('a', 720), level('b', 480)];
    for (const value of [
      null, 'text', [], { levels: two }, { mediaId: '', levels: two }, { mediaId: 'x'.repeat(201), levels: two },
      { mediaId: 'item', levels: 'a,b' },
      { mediaId: 'item', levels: Array.from({ length: 41 }, (_, i) => level(String(i), i + 1)) },
      { mediaId: 'item', levels: [...two, null] },
      { mediaId: 'item', levels: [...two, { id: 'c', label: '1p', height: 0 }] },
      { mediaId: 'item', levels: [...two, { id: 'c', label: '1p', height: 1.5 }] },
      { mediaId: 'item', levels: [...two, { id: 'c', label: 7, height: 360 }] },
      { mediaId: 'item', levels: [...two, { id: 'c'.repeat(101), label: '360p', height: 360 }] }
    ]) {
      assert.equal(normalizeVideoQuality(value), null, JSON.stringify(value)?.slice(0, 80));
    }
  });

  it('bounds labels', () => {
    const state = normalizeVideoQuality({ mediaId: 'item', levels: [level('a', 720, `720p${'x'.repeat(100)}`), level('b', 480)] });
    assert.equal(state?.levels[0]?.label.length, 60);
  });
});
