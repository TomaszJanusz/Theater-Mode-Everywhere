/**
 * Largest dip: the most an effect lowers a signal over any 50 ms, in dB (80 Hz to 12 kHz). A level
 * taken over a whole clip hides a gain that falls by 10 dB for a fifth of a second and comes back,
 * which is what pumping is; this is the deepest such moment. On sound the effect should leave alone
 * it should be 0 dB.
 *
 * The windows are 9 frames long (48 ms). Only windows inside `mask` count, and only where the
 * signal sounded before the effect: within 30 dB of its loudest window. NaN when none does.
 */
import { dB, framePower, voiceBand, type Grid } from './grid';

const WINDOW_FRAMES = 9;
const SOUNDING = 1e-3;

export function largestDip(before: Grid, after: Grid, mask?: Uint8Array): number {
  const [powerBefore, powerAfter] = [before, after].map(grid => framePower(grid, voiceBand(grid)));
  const sums: [number, number][] = [];
  for (let m = 0; m + WINDOW_FRAMES <= before.frames; m++) {
    if (mask && !mask.subarray(m, m + WINDOW_FRAMES).every(value => value === 1)) continue;
    const sumOf = (power: Float64Array) => power.subarray(m, m + WINDOW_FRAMES).reduce((sum, value) => sum + value, 0);
    sums.push([sumOf(powerBefore), sumOf(powerAfter)]);
  }
  const loudest = sums.reduce((max, [sum]) => Math.max(max, sum), 0);
  const dips = sums.filter(([sum]) => sum > SOUNDING * loudest).map(([was, now]) => dB(was) - dB(now));
  return dips.length === 0 ? Number.NaN : Math.max(0, ...dips);
}
