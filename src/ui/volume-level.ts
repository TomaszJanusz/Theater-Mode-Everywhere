/** Volume slider levels: 1 is 100%; boost lifts the level above 1 up to the ceiling. */

export const VOLUME_STEP = 0.05;
/** Levels this close to 100% count as 100% when stepping, so float drift never skips the stop. */
const EPSILON = 1e-6;

/** Boost levels stretch 4x: slider level 1.5 is a 300% gain. */
export function volumePercent(level: number): number {
  return Math.round(level <= 1 ? level * 100 : 100 + (level - 1) * 400);
}

const tidy = (level: number) => Math.round(level * 1e4) / 1e4;

/** Moving from `from` to `to` may not skip over 100% in either direction. */
export function stopAtFullVolume(from: number, to: number): number {
  const crossesUp = from < 1 - EPSILON && to > 1 + EPSILON;
  const crossesDown = from > 1 + EPSILON && to < 1 - EPSILON;
  return crossesUp || crossesDown ? 1 : to;
}

/**
 * The next level for one volume step. Steps are 5% from wherever the volume is (72% stays
 * reachable) but always land on 100% when passing it; above 100% only while `ceiling` allows.
 */
export function nextVolumeLevel(current: number, direction: 'up' | 'down', ceiling: number): number {
  const limit = Math.max(1, ceiling);
  if (direction === 'up') {
    const next = stopAtFullVolume(current, current + VOLUME_STEP);
    return tidy(Math.min(limit, next));
  }
  const next = tidy(stopAtFullVolume(current, current - VOLUME_STEP));
  return next < EPSILON ? 0 : next;
}
