import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BURST, bursts, decays, shaped, stereo } from '../test-utils/signals';

import { describeFrames, speechInDryVoice } from './frames';
import { powerGrid } from './grid';
import { levelMovement } from './level-movement';
import { tailLevel } from './tail-decay';
import { voiceLevel } from './voice-loss';
import { wordEndingLevel } from './word-ending-loss';

describe('audio lab: level metrics', () => {
  const voice = bursts(5);
  const reverb = decays(5);
  const before = { voice: powerGrid(stereo(voice)), reverb: powerGrid(stereo(reverb)) };
  const frames = describeFrames(speechInDryVoice(before.voice), before.voice.frameHz);
  const speaking = (phase: number) => phase < BURST.on;

  it('voice loss is the level change of the voice while it speaks, whatever happens in the pauses', () => {
    const after = powerGrid(stereo(shaped(voice, phase => (speaking(phase) ? -3 : -30))));
    const loss = voiceLevel(after, frames) - voiceLevel(before.voice, frames);
    assert.ok(Math.abs(loss - -3) < 0.1, `${loss.toFixed(2)} dB`);
  });

  it('tail decay is the level change of the reverb in the pause tails, whatever happens under speech', () => {
    const after = powerGrid(stereo(shaped(reverb, phase => (speaking(phase) || phase > BURST.on + 0.02 ? -8 : 0) + (speaking(phase) ? 8 : 0))));
    const drop = tailLevel(after, frames) - tailLevel(before.reverb, frames);
    assert.ok(Math.abs(drop - -8) < 0.2, `${drop.toFixed(2)} dB`);
    // The same level over speech frames would show nothing: the reverb under speech was left alone.
    const underSpeech = voiceLevel(after, frames) - voiceLevel(before.reverb, frames);
    assert.ok(Math.abs(underSpeech) < 0.5, `${underSpeech.toFixed(2)} dB under speech`);
  });

  it('word-ending loss sees a cut that the overall voice loss barely registers', () => {
    const after = powerGrid(stereo(shaped(voice, phase => (phase > BURST.on - 0.06 && speaking(phase) ? -9 : 0))));
    const ending = wordEndingLevel(after, frames) - wordEndingLevel(before.voice, frames);
    const overall = voiceLevel(after, frames) - voiceLevel(before.voice, frames);
    assert.ok(ending < -6 && ending > -9.2, `endings lose ${ending.toFixed(2)} dB`);
    assert.ok(overall > -1.5, `the whole voice only ${overall.toFixed(2)} dB`);
  });

  it('level movement is the spread of the gain on the voice: zero for a steady loss', () => {
    const steady = powerGrid(stereo(shaped(voice, () => -5)));
    assert.ok(levelMovement(before.voice, steady, frames) < 0.01, 'a constant gain does not move the level');
    assert.equal(levelMovement(before.voice, before.voice, frames), 0);
    // Half of each word 4 dB lower: the gain sits at 0 or -4 dB, a spread of 2 dB.
    const moved = powerGrid(stereo(shaped(voice, phase => (phase > BURST.on / 2 ? -4 : 0))));
    const movement = levelMovement(before.voice, moved, frames);
    assert.ok(Math.abs(movement - 2) < 0.25, `${movement.toFixed(2)} dB`);
  });

  it('returns NaN instead of a number when there is nothing to measure', () => {
    const none = { speech: new Uint8Array(before.voice.frames), tail: new Uint8Array(before.voice.frames), wordEnding: new Uint8Array(before.voice.frames), away: new Uint8Array(before.voice.frames) };
    assert.ok(Number.isNaN(voiceLevel(before.voice, none)));
    assert.ok(Number.isNaN(tailLevel(before.reverb, none)));
    assert.ok(Number.isNaN(wordEndingLevel(before.voice, none)));
    assert.ok(Number.isNaN(levelMovement(before.voice, before.voice, none)));
  });
});
