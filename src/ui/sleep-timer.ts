import type { DisposableScope } from '../core/disposable-scope';
import {
  resolveSleepTimer, SLEEP_TIMER_ACTION, SLEEP_TIMER_MINUTES, type SleepTimer, type SleepTimerBroadcast
} from '../core/sleep-timer';

import type { ButtonTooltipBinder } from './button-tooltip';
import { SLEEP_TIMER_ICONS } from './hud';
import type { createPlayerSettings } from './player-settings';
import type { PlayerChromeContext } from './runtime-context';
import { createSleepTimerChip } from './sleep-timer-chip';
import { systemClock } from './ui-clock';

/**
 * The player's part of the profile-wide sleep timer: a settings row that sets it, the control bar chip that shows
 * it, and the pause when it fires. The background owns the timer; this player asks it once and then follows its
 * broadcasts until the controls go.
 */
export function mountSleepTimer(
  ctx: PlayerChromeContext,
  settings: ReturnType<typeof createPlayerSettings>,
  scope: DisposableScope,
  bindTooltip: ButtonTooltipBinder
): HTMLButtonElement {
  const { t } = ctx;
  const row = document.createElement('div');
  row.className = 'sleep-timer-btn';
  ctx.actions.setIcon(row, SLEEP_TIMER_ICONS.menu);
  let timer: SleepTimer | null = null;
  // A broadcast or a later request supersedes an answer still on its way.
  let revision = 0;
  const apply = (value: unknown) => {
    if (scope.signal.aborted) return;
    timer = resolveSleepTimer(value);
    chip.set(timer);
  };
  const request = (minutes?: number) => {
    const sent = ++revision;
    try {
      chrome.runtime.sendMessage({ action: SLEEP_TIMER_ACTION, minutes })
        .then((value: unknown) => { if (sent === revision) apply(value); }, () => {});
    } catch {
      // No extension context (an invalidated one, or a fixture page): the timer reads as off here.
    }
  };
  const index = () => SLEEP_TIMER_MINUTES.indexOf((timer?.minutes ?? 0) as typeof SLEEP_TIMER_MINUTES[number]);
  const stepper = settings.addStepperRow(row, t('sleepTimerLabel'), 'player', {
    onStep: direction => request(SLEEP_TIMER_MINUTES[index() + direction])
  });
  const chip = createSleepTimerChip({
    scope, clock: systemClock, wallNow: Date.now, t, bindTooltip,
    onActivate: keyboard => settings.openAt(
      row.querySelector<HTMLElement>('.theater-stepper-btn:not([aria-disabled="true"])') ?? undefined, keyboard),
    onChange: text => {
      row.dataset.active = String(!!text);
      stepper.updateStepper('', {
        value: text ?? t('sleepTimerOff'), index: text ? index() : 0, count: SLEEP_TIMER_MINUTES.length
      });
    }
  });
  chip.set(null);
  const onMessage = (message: SleepTimerBroadcast) => {
    if (message?.action !== SLEEP_TIMER_ACTION) return;
    revision++;
    apply(message.timer);
    if (message.fired === true) ctx.actions.executeCommand({ type: 'SLEEP_TIMER_PAUSE' });
  };
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(onMessage);
    scope.add(() => chrome.runtime.onMessage.removeListener(onMessage));
  }
  request();
  return chip.element;
}
