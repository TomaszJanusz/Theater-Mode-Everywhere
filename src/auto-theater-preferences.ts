/** Public AutoTheater preferences shared by extension options and the player runtime. */
export const AUTO_THEATER_STORAGE_KEY = 'autoEnterTheater';
export const DEFAULT_AUTO_THEATER = true;
export const AUTO_SKIP_COUNTDOWN_KEY = 'autoTheaterSkipCountdown';

export function resolveSkipCountdown(value: unknown): boolean {
  return value === true;
}

/** An absent or malformed value means the default; only an explicit boolean overrides it. */
export function resolveAutoEnterTheater(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_AUTO_THEATER;
}
