import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { syntheticMaterial } from '../synthetic';

import { firstArrival, REFERENCE_POINTS, reflectionShares, splitResponse } from './early-late';

const RATE = 48000;
const at = (ms: number) => Math.round(ms / 1000 * RATE);

/** Direct sound after 3 ms of delay, then reflections 5, 15, 30 and 100 ms behind it. */
function response(): Float64Array {
  const h = new Float64Array(at(200));
  const start = at(3);
  h[start] = 1;
  h[start + at(5)] = Math.sqrt(0.2);
  h[start + at(15)] = -Math.sqrt(0.3);
  h[start + at(30)] = Math.sqrt(0.4);
  h[start + at(100)] = Math.sqrt(0.1);
  return h;
}

describe('audio lab: early/late split', () => {
  it('names its reference points: direct sound, 10, 20 and 50 ms', () => {
    assert.deepEqual(REFERENCE_POINTS.map(point => point.key), ['direct', '10ms', '20ms', '50ms']);
    assert.deepEqual(REFERENCE_POINTS.map(point => point.ms), [2.5, 10, 20, 50]);
  });

  it('measures from the first arrival, the earliest across channels', () => {
    const late = new Float64Array(at(200));
    late[at(4)] = 1;
    assert.equal(firstArrival([response()]), at(3));
    assert.equal(firstArrival([late, response()]), at(3));
  });

  it('cuts a response into parts that keep their place and add up to it', () => {
    const h = response();
    const parts = splitResponse([h], RATE);
    assert.equal(parts.length, 5);
    const energy = (part: Float64Array[]) => part[0].reduce((sum, value) => sum + value * value, 0);
    for (const [index, expected] of [1, 0.2, 0.3, 0.4, 0.1].entries()) assert.ok(Math.abs(energy(parts[index]) - expected) < 1e-12, `part ${index}`);
    // The cut starts 1 ms before the first arrival, to keep the rise of a band-limited response.
    const trimmed = h.subarray(at(2));
    for (let i = 0; i < trimmed.length; i++) {
      const sum = parts.reduce((total, part) => total + (part[0][i] ?? 0), 0);
      assert.equal(sum, trimmed[i]);
    }
  });

  it('states how much of the reflected energy each point counts as early', () => {
    const shares = reflectionShares([response()], RATE);
    assert.equal(shares.direct, 0);
    assert.ok(Math.abs(shares['10ms'] - 0.2) < 1e-12);
    assert.ok(Math.abs(shares['20ms'] - 0.5) < 1e-12);
    assert.ok(Math.abs(shares['50ms'] - 0.9) < 1e-12);
  });

  it('shows why 50 ms hides wall reflections: the built-in wall room has 91 % of them before it', () => {
    const wall = syntheticMaterial('synthetic-wall', 1).room;
    const diffuse = syntheticMaterial('synthetic-room-0.8s', 1).room;
    assert.ok(wall && diffuse);
    assert.ok(Math.abs(wall.shares['50ms'] - 0.91) < 0.005, `${wall.shares['50ms']}`);
    assert.ok(wall.shares['20ms'] > 0.5 && wall.shares['20ms'] < wall.shares['50ms']);
    assert.ok(diffuse.shares['50ms'] < 0.3, 'a diffuse room keeps most of its energy for the tail');
  });
});
