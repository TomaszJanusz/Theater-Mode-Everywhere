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

  it('calls the voice away once it has been silent for 1.5 s, and before it first speaks', () => {
    const speech = new Uint8Array(1000);
    speech.fill(1, 100, 200);
    speech.fill(1, 300, 320);
    const { away } = describeFrames(speech, FRAME_HZ);
    const from = Math.round(1.5 * FRAME_HZ);
    assert.ok(away.subarray(0, 100).every(value => value === 1), 'nothing was spoken yet');
    assert.ok(away.subarray(100, 320 + from - 1).every(value => value === 0), 'speech, a short pause and the first 1.5 s after it');
    assert.ok(away.subarray(320 + from - 1).every(value => value === 1), 'from 1.5 s after the last word');
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
    const count = Math.round(0.06 * FRAME_HZ);
    assert.equal(labelled.wordEnding.reduce((sum, value) => sum + value, 0), count, '60 ms is 11 frames, not 12');
    assert.equal(labelled.wordEnding[149], 1);
    assert.equal(labelled.wordEnding[150 - count], 1);
    assert.equal(labelled.wordEnding[149 - count], 0);
  });

  it('counts only the speech of the last 60 ms when a closure falls inside them', () => {
    const speech = new Uint8Array(200).fill(1);
    // Speech, a 20 ms closure, 20 ms of speech, then the pause.
    speech.fill(0, 140, 144);
    speech.fill(0, 148);
    const { wordEnding } = describeFrames(speech, FRAME_HZ);
    assert.deepEqual(Array.from(wordEnding.subarray(136, 149)), [0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0]);
  });

  it('finds no speech in a silent reference instead of calling all of it speech', () => {
    const silent = powerGrid(stereo(new Float32Array(RATE)));
    const labelled = describeFrames(speechInDryVoice(silent), silent.frameHz);
    for (const mask of [labelled.speech, labelled.tail, labelled.wordEnding]) assert.ok(mask.every(value => value === 0));
    const faint = powerGrid(stereo(bursts(1).map(value => 1e-6 * value)));
    assert.ok(speechInDryVoice(faint).every(value => value === 0), 'sound under -100 dBFS is no voice either');
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
