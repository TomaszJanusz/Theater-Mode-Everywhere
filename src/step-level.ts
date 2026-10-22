/** One step along an ordered list of options, held at either end instead of wrapping. */
export function stepLevel<T>(levels: readonly T[], current: T, direction: 1 | -1): T {
  const index = levels.indexOf(current);
  if (index < 0) return levels[0];
  return levels[Math.min(levels.length - 1, Math.max(0, index + direction))];
}
