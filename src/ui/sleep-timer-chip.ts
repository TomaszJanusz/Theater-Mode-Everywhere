import type { DisposableScope } from '../core/disposable-scope';
import { sleepTimerMinutesLeft, type SleepTimer } from '../core/sleep-timer';

import type { ButtonTooltipBinder } from './button-tooltip';
import { SLEEP_TIMER_ICONS } from './hud';
import { createSvgIcon } from './svg-icon';
import type { UiClock } from './ui-clock';

export interface SleepTimerChipOptions {
  scope: DisposableScope;
  /** Schedules the countdown; stories pass a manual clock. */
  clock: UiClock;
  /** The wall clock the shared deadline is set on, so every tab counts down to the same moment. */
  wallNow: () => number;
  t: (key: string, substitutions?: string | string[]) => string;
  bindTooltip: ButtonTooltipBinder;
  /** Opens the settings menu at the sleep timer; `keyboard` moves focus there too. */
  onActivate: (keyboard: boolean) => void;
  /** The countdown text after each change, or null when no timer runs: the settings row shows the same value. */
  onChange?: (text: string | null) => void;
}

/**
 * The control bar's sign of a running sleep timer: a moon and the minutes left. Absent (no reserved space) while
 * no timer runs. It repaints at each minute boundary of the deadline, and not at all while the tab is hidden.
 */
export function createSleepTimerChip(options: SleepTimerChipOptions): {
  element: HTMLButtonElement;
  set: (timer: SleepTimer | null) => void;
} {
  const { scope, clock, t } = options;
  const element = document.createElement('button');
  element.type = 'button';
  element.className = 'theater-control-btn sleep-timer-chip';
  element.hidden = true;
  const text = document.createElement('span');
  element.append(createSvgIcon(SLEEP_TIMER_ICONS.menu), text);
  options.bindTooltip(element, () => element.getAttribute('aria-label') ?? '');
  scope.listen(element, 'click', (event: MouseEvent) => options.onActivate(event.detail === 0));

  let timer: SleepTimer | null = null;
  let tick: number | undefined;
  const render = () => {
    clock.clearTimeout(tick);
    tick = undefined;
    const now = options.wallNow();
    const minutes = sleepTimerMinutesLeft(timer, now);
    const label = minutes > 1 ? t('sleepTimerMinutes', String(minutes)) : t('sleepTimerUnderMinute');
    element.hidden = !minutes;
    text.textContent = label;
    element.setAttribute('aria-label', t('sleepTimerPausesIn', label));
    options.onChange?.(minutes ? label : null);
    // The next whole minute before the deadline; the background's broadcast clears the chip when it fires.
    if (minutes && !document.hidden) tick = clock.setTimeout(render, (timer!.deadline - now - 1) % 60_000 + 1);
  };
  scope.listen(document, 'visibilitychange', render);
  scope.add(() => clock.clearTimeout(tick));
  return {
    element,
    set(next) {
      timer = next;
      render();
    }
  };
}
