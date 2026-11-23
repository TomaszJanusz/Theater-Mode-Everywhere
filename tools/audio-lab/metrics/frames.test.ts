import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BURST, bursts, decays, RATE, stereo } from '../test-utils/signals';

import { describeFrames, speechInDryVoice, speechInMix } from './frames';
import { HOP, powerGrid } from './grid';

const FRAME_HZ = RATE / HOP;
/** Seconds into the burst period of the centre of frame `m`. */
const phaseOf = (m: number) => (((m + 1) * HOP - 512) / RATE) % BURST.period;

describe('audio lab: frame labels', () => {
  const dry = powerGrid(stereo(bursts(4)));
  const frames = describeFrames(speechInDryVoice(dry), dry.frameHz);

  it('labels a dry voice as speech exactly while it sounds', () => {
    for (let m = 8; m < dry.frames; m++) {
      const phase = phaseOf(m);
      if (phase > 0.02 && phase < BURST.on - 0.02) assert.equal(frames.speech[m], 1, `frame at ${phase.toFixed(3)} s is speech`);
      if (phase > BURST.on + 0.02 && phase < BURST.period - 0.02) assert.equal(frames.speech[m], 0, `frame at ${phase.toFixed(3)} s is pause`);
    }
  });

  it('puts the tail 50 to 300 ms after the voice stops and nowhere inside speech', () => {
    for (let m = 8; m < dry.frames; m++) {
      const since = phaseOf(m) - BURST.on;
      if (since > 0.08 && since < 0.28) assert.equal(frames.tail[m], 1, `${since.toFixed(3)} s after the stop is tail`);
      if (since < 0.03 || since > 0.33) assert.equal(frames.tail[m], 0, `${since.toFixed(3)} s after the stop is no tail`);
    }
    const leading = describeFrames(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1), FRAME_HZ);
    assert.ok(leading.tail.every(value => value === 0), 'silence before the first word follows no speech');
  });

  it('marks the last 60 ms of a word, but only before a real pause', () => {
    for (let m = 8; m < dry.frames - 40; m++) {
      const left = BURST.on - phaseOf(m);
      if (left > 0.02 && left < 0.05) assert.equal(frames.wordEnding[m], 1, `${left.toFixed(3)} s before the stop is an ending`);
      if (left > 0.1 || left < -0.02) assert.equal(frames.wordEnding[m], 0, `${left.toFixed(3)} s before the stop is not`);
    }
    const speech = new Uint8Array(200).fill(1);
    // A 60 ms closure inside a word, then a real stop.
    speech.fill(0, 50, 50 + Math.round(0.06 * FRAME_HZ));
    speech.fill(0, 150);
    const labelled = describeFrames(speech, FRAME_HZ);
    assert.equal(labelled.wordEnding[49], 0, 'a short closure does not end a word');
    assert.equal(labelled.wordEnding[149], 1);
    assert.equal(labelled.wordEnding[149 - Math.round(0.06 * FRAME_HZ)], 1);
    assert.equal(labelled.wordEnding[149 - Math.round(0.06 * FRAME_HZ) - 1], 0);
  });

  it('reads speech from a reverberant mix only roughly, which is why a dry reference is preferred', () => {
    const room = decays(4);
    const mix = bursts(4).map((value, i) => value + room[i]);
    const fromMix = speechInMix(powerGrid(stereo(mix)));
    let agree = 0;
    for (let m = 0; m < dry.frames; m++) if (fromMix[m] === frames.speech[m]) agree++;
    assert.ok(agree / dry.frames > 0.7, `the fallback finds the loud part (${(100 * agree / dry.frames).toFixed(0)} % agreement)`);
    assert.ok(agree / dry.frames < 1, 'but the room keeps frames "speaking" after the voice stopped');
    const silent = speechInMix(powerGrid(stereo(new Float32Array(RATE))));
    assert.ok(silent.every(value => value === 0), 'digital silence holds no speech');
  });
});
