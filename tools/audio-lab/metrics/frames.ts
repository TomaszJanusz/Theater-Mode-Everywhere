/**
 * Which frames are speech, which are the pause tails after it and which are word endings. Every
 * voice and reverb metric is a level over one of these sets, so the sets are defined once, here.
 *
 * Labels should come from the dry voice: it says when the talker spoke, whatever the room and the
 * effect did afterwards. Labels read from a reverberant stream agree with the dry source's on only
 * 29 to 39 % of frames (TME-279 review), so `speechInMix` is a fallback for material with no
 * reference, and metrics built on it describe the mix, not the voice.
 */
import { dB, framePower, voiceBand, type Grid } from './grid';

export type Frames = {
  /** The voice is sounding. */
  speech: Uint8Array;
  /** 50 to 300 ms after the voice stopped, while it stays silent: the direct sound and first reflections of the last word are gone and what sounds is the room. */
  tail: Uint8Array;
  /**
   * Speech in the last 60 ms before a pause of at least 100 ms: where words fade out and a gate
   * bites first. A short closure inside those 60 ms is not speech and is left out; the speech on
   * its far side still counts.
   */
  wordEnding: Uint8Array;
  /**
   * The voice has not sounded for 1.5 s, or not yet at all: no speech was just present, so what
   * sounds here is neither the voice nor its echo. Longer than any tail the effect may follow.
   */
  away: Uint8Array;
};

const TAIL_FROM = 0.05;
const TAIL_TO = 0.3;
const ENDING = 0.06;
const ENDING_PAUSE = 0.1;
const AWAY_FROM = 1.5;

const levels = (grid: Grid): Float64Array => framePower(grid, voiceBand(grid)).map(dB);

/** Below this no frame is speech: a reference that never rises above it is silence, not a quiet voice. */
const SILENCE_DBFS = -100;

/**
 * A clean voice speaks in the frames within 40 dB of its loud ones (the 95th percentile of its
 * level). A silent reference has no loud frames and so no speech.
 */
export function speechInDryVoice(grid: Grid): Uint8Array {
  const level = levels(grid);
  const sorted = Float64Array.from(level).sort();
  const loud = sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))];
  return Uint8Array.from(level, value => (value > loud - 40 && value > SILENCE_DBFS ? 1 : 0));
}

/**
 * Without a reference, speech is taken to be the frames within 18 dB of the loudest frame of the
 * surrounding 1.5 s and above -65 dBFS (TME-275's pause rule, inverted). Music and reverb pass too.
 */
export function speechInMix(grid: Grid): Uint8Array {
  const level = levels(grid);
  const reach = Math.round(0.75 * grid.frameHz);
  return Uint8Array.from(level, (value, m) => {
    let peak = Number.NEGATIVE_INFINITY;
    for (let i = Math.max(0, m - reach); i <= Math.min(level.length - 1, m + reach); i++) peak = Math.max(peak, level[i]);
    return value > peak - 18 && value > -65 ? 1 : 0;
  });
}

export function describeFrames(speech: Uint8Array, frameHz: number): Frames {
  const frames = speech.length;
  const tail = new Uint8Array(frames);
  const wordEnding = new Uint8Array(frames);
  const away = new Uint8Array(frames);
  const [tailFrom, tailTo, ending, endingPause, awayFrom] = [TAIL_FROM, TAIL_TO, ENDING, ENDING_PAUSE, AWAY_FROM].map(seconds => Math.round(seconds * frameHz));
  // Frames before the first word follow no speech, so they are no tail.
  let sinceStop = Number.POSITIVE_INFINITY;
  for (let m = 0; m < frames; m++) {
    sinceStop = speech[m] ? 0 : sinceStop + 1;
    if (sinceStop >= tailFrom && sinceStop <= tailTo) tail[m] = 1;
    if (sinceStop >= awayFrom) away[m] = 1;
    const stops = speech[m] && m + 1 < frames && !speech[m + 1];
    if (stops && m + endingPause < frames && speech.subarray(m + 1, m + 1 + endingPause).every(value => value === 0)) {
      wordEnding.fill(1, Math.max(0, m + 1 - ending), m + 1);
    }
  }
  for (let m = 0; m < frames; m++) if (!speech[m]) wordEnding[m] = 0;
  return { speech, tail, wordEnding, away };
}
