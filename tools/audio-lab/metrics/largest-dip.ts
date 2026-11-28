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

/**
 * The same on the power of each frame, before and after. Two passes over running sums, so a film
 * costs as little memory as a clip.
 */
export function largestDipOf(before: Float64Array, after: Float64Array, mask?: Uint8Array): number {
  /** Calls `visit` with the power before and after of every window that lies inside the mask. */
  const windows = (visit: (was: number, now: number) => void): void => {
    let [was, now, masked] = [0, 0, 0];
    for (let m = 0; m < before.length; m++) {
      was += before[m];
      now += after[m];
      masked += mask && !mask[m] ? 1 : 0;
      if (m < WINDOW_FRAMES - 1) continue;
      if (masked === 0) visit(was, now);
      const first = m - WINDOW_FRAMES + 1;
      was -= before[first];
      now -= after[first];
      masked -= mask && !mask[first] ? 1 : 0;
    }
  };
  let loudest = 0;
  windows(was => { loudest = Math.max(loudest, was); });
  let deepest = Number.NaN;
  windows((was, now) => {
    if (was > SOUNDING * loudest) deepest = Math.max(Number.isNaN(deepest) ? 0 : deepest, dB(was) - dB(now));
  });
  return deepest;
}

export function largestDip(before: Grid, after: Grid, mask?: Uint8Array): number {
  const [powerBefore, powerAfter] = [before, after].map(grid => framePower(grid, voiceBand(grid)));
  return largestDipOf(powerBefore, powerAfter, mask);
}
