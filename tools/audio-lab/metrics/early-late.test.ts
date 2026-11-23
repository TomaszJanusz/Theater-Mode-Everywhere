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
    assert.equal(firstArrival([response()], RATE), at(3));
    assert.equal(firstArrival([late, response()], RATE), at(3));
  });

  it('finds a direct sound that is weaker than the reflection behind it', () => {
    // An off-axis talker in front of a wall: the direct tap is 11 dB under the wall's.
    const h = new Float64Array(at(200));
    h[at(3)] = 0.22;
    h[at(45)] = 0.77;
    assert.equal(firstArrival([h], RATE), at(3));
    const parts = splitResponse([h], RATE);
    assert.ok(Math.abs(parts[0][0][at(1)] - 0.22) < 1e-12, 'the weak tap is the direct sound');
    assert.ok(Math.abs(parts[3][0][at(43)] - 0.77) < 1e-12, 'and the wall is a reflection 42 ms later');
    // Below 20 dB under the peak the search cannot tell an arrival from noise: the material has to say.
    h[at(3)] = 0.05;
    assert.equal(firstArrival([h], RATE), at(45));
    const stated = splitResponse([h], RATE, at(3));
    assert.ok(Math.abs(stated[0][0][at(1)] - 0.05) < 1e-12 && Math.abs(stated[3][0][at(43)] - 0.77) < 1e-12, 'a stated arrival wins over the search');
  });

  it('takes a band-limited arrival at its peak, not at the ripple ahead of it', () => {
    // A windowed sinc as resampling leaves it: side lobes of 22 % and 13 % of the peak lead the main lobe.
    const h = new Float64Array(at(20));
    for (let i = -30; i <= 30; i++) h[at(5) + i] = i === 0 ? 1 : Math.sin(Math.PI * i / 3) / (Math.PI * i / 3) * (0.5 + 0.5 * Math.cos(Math.PI * i / 30));
    assert.equal(firstArrival([h], RATE), at(5));
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
    const shares = reflectionShares(splitResponse([response()], RATE));
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
