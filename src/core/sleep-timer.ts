/** Off, then the durations the player settings offer, in minutes. */
export const SLEEP_TIMER_MINUTES = [0, 15, 30, 45, 60, 90, 120, 240] as const;

/**
 * One message action both ways: a frame asks the background (`minutes` sets the timer, 0 turns it off, none reads
 * it), and the background tells every frame of every tab the new state (`fired` when it ran out).
 */
export const SLEEP_TIMER_ACTION = 'sleep-timer';

/** The profile's one sleep timer: playing media pauses at `deadline` (wall-clock ms), `minutes` after it was set. */
export interface SleepTimer {
  minutes: number;
  deadline: number;
}

export interface SleepTimerBroadcast {
  action: typeof SLEEP_TIMER_ACTION;
  timer: SleepTimer | null;
  fired?: true;
}

const isDuration = (value: unknown): value is number =>
  typeof value === 'number' && value > 0 && (SLEEP_TIMER_MINUTES as readonly number[]).includes(value);

/** A stored or received timer, or null for anything else. */
export function resolveSleepTimer(value: unknown): SleepTimer | null {
  const timer = value as Partial<Record<keyof SleepTimer, unknown>> | null | undefined;
  return isDuration(timer?.minutes) && Number.isFinite(timer?.deadline) ? timer as SleepTimer : null;
}

/** A duration a request may set: 0 (Off) or one of the offered minutes; undefined only reads. */
export function resolveSleepTimerRequest(value: unknown): number | undefined {
  return value === 0 || isDuration(value) ? value : undefined;
}

/** Minutes the countdown shows: rounded up, so it reads the full duration when set and 1 in the last minute. */
export const sleepTimerMinutesLeft = (timer: SleepTimer | null, now: number): number =>
  timer ? Math.max(0, Math.ceil((timer.deadline - now) / 60_000)) : 0;

/**
 * The segment the settings row lights for a timer: the longest offered duration the minutes left still cover (110
 * left lights 90), and at least the first one while a timer runs. Off without a running timer. The row's label is
 * the time left itself.
 */
export function sleepTimerSegment(timer: SleepTimer | null, now: number): number {
  const left = sleepTimerMinutesLeft(timer, now);
  return left ? Math.max(1, SLEEP_TIMER_MINUTES.findLastIndex(minutes => minutes <= left)) : 0;
}

/**
 * The duration a step of the settings row starts from now: the next option above the minutes left (110 left steps
 * up to 120, 120 left to 240) or below them (Off at the bottom), so a step always changes the timer. Undefined
 * where nothing lies that way: up from 240 or more, down with no timer.
 */
export function sleepTimerStep(timer: SleepTimer | null, now: number, direction: 1 | -1): number | undefined {
  const left = sleepTimerMinutesLeft(timer, now);
  return direction > 0 ? SLEEP_TIMER_MINUTES.find(minutes => minutes > left) : SLEEP_TIMER_MINUTES.findLast(minutes => minutes < left);
}
