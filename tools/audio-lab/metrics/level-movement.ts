/**
 * Level movement: how much the effect moves the voice's level about while it speaks. Each speech
 * frame has a broadband gain (the voice's power after over its power before, 80 Hz to 12 kHz);
 * the metric is the spread (standard deviation, dB) of that gain over the speech frames. A steady
 * loss is a volume change; a spread of a few dB is audible as pumping or a voice that fades inside
 * words. Without the effect it is 0 by definition.
 */
import type { Frames } from './frames';
import { dB, framePower, voiceBand, type Grid } from './grid';

export function levelMovement(before: Grid, after: Grid, frames: Frames): number {
  const [powerBefore, powerAfter] = [before, after].map(grid => framePower(grid, voiceBand(grid)));
  const gains: number[] = [];
  for (let m = 0; m < before.frames; m++) {
    if (frames.speech[m] && powerBefore[m] > 0) gains.push(dB(powerAfter[m]) - dB(powerBefore[m]));
  }
  if (gains.length === 0) return Number.NaN;
  const mean = gains.reduce((sum, gain) => sum + gain, 0) / gains.length;
  return Math.sqrt(gains.reduce((sum, gain) => sum + (gain - mean) ** 2, 0) / gains.length);
}
