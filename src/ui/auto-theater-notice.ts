import { exitSpinner, isElementMotionReduced } from './spinner-exit';
import { mountPlayerUi } from './root';
import { HUD_PLATE_CLASS } from './hud';
import { renderKbdText } from './kbd-text';
import { t } from './messages';
import { msUntilNoticeSecondChanges, noticeSecondsRemaining } from './auto-theater-intent';
import { renderTimeReadout } from './time-readout';
import { showAutoTheaterScrim, type AutoTheaterScrimOptions } from './auto-theater-scrim';

export const AUTO_THEATER_NOTICE_CLASS = 'theater-auto-notice';

/** `uniform` turns the ring at a constant speed; `per-digit` makes one eased turn per displayed second. */
export type CountdownRingTurn = 'uniform' | 'per-digit';
export const DEFAULT_COUNTDOWN_RING_TURN: CountdownRingTurn = 'uniform';

/**
 * Corner notice for a pending automatic theater entry. It reuses the caption
 * loading plate and spinner; unlike HUDs it takes clicks, but never focus.
 * The role=status region announces itself on insertion; the seconds counter inside the
 * spinner is decorative (aria-hidden), so ticks are never announced. The counter is
 * derived from `remainingMs`, the intent's own clock, and re-armed only at each change
 * of the displayed second (ending on 0). With `scrim`, a backdrop dims the loading page behind it for
 * the same lifetime. Returns idempotent cleanup.
 */
export function showAutoTheaterNotice(
  paintOverlay: (element: HTMLElement) => void,
  onCancel: () => void,
  remainingMs: () => number,
  ringTurn: CountdownRingTurn = DEFAULT_COUNTDOWN_RING_TURN,
  scrim?: AutoTheaterScrimOptions
): () => void {
  const hint = t('autoEnterNoticeHint', 'Esc');
  const title = t('autoEnterNoticeTitle');
  const overlay = document.createElement('div');
  overlay.className = `theater-everywhere-caption-hud ${HUD_PLATE_CLASS} status-hud loading ${AUTO_THEATER_NOTICE_CLASS}`;
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.setAttribute('aria-label', `${title} ${hint.replace(/<\/?kbd>/g, '')}`);
  paintOverlay(overlay);

  const content = document.createElement('div');
  content.className = 'volume-hud-content caption-hud-content';
  const icon = document.createElement('div');
  icon.className = 'volume-hud-icon';
  const spinner = document.createElement('div');
  spinner.className = 'caption-hud-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  const count = document.createElement('span');
  count.className = 'theater-time-display theater-auto-notice-count';
  count.setAttribute('aria-hidden', 'true');
  const visual = document.createElement('div');
  visual.className = 'theater-auto-notice-visual';
  visual.append(spinner, count);
  icon.appendChild(visual);
  const copy = document.createElement('div');
  copy.className = 'volume-hud-copy';
  const titleEl = document.createElement('span');
  titleEl.className = 'volume-hud-text';
  titleEl.textContent = title;
  const hintEl = document.createElement('span');
  hintEl.className = 'volume-hud-detail theater-auto-notice-hint';
  renderKbdText(hintEl, hint);
  copy.append(titleEl, hintEl);
  content.append(icon, copy);
  overlay.appendChild(content);

  overlay.addEventListener('click', event => {
    event.stopPropagation();
    onCancel();
  });
  // Pointer presses must not reach the host player or move focus.
  overlay.addEventListener('mousedown', event => event.preventDefault());
  let timer: number | undefined;
  let stopped = false;
  let turn: Animation | undefined;
  // Both modes join where the clock says the countdown is, so ring and digit never drift.
  const turnRing = (remaining: number): void => {
    if (ringTurn === 'uniform' && turn) return;
    turn?.cancel();
    turn = undefined;
    if (isElementMotionReduced(spinner)) return;
    if (ringTurn === 'uniform') {
      // One turn per second, phased so each turn completes as the digit changes. Created once: it keeps
      // its own constant speed and is never restarted by digit ticks.
      turn = spinner.animate([{ rotate: '0deg' }, { rotate: '360deg' }], { duration: 1000, iterations: Infinity, easing: 'linear' });
      turn.currentTime = (1000 - (remaining % 1000)) % 1000;
      return;
    }
    // One eased turn per displayed second, started by the tick that changes the digit.
    const intoSecond = 1000 - (remaining - noticeSecondsRemaining(remaining) * 1000);
    turn = spinner.animate([{ rotate: '0deg' }, { rotate: '360deg' }], { duration: 1000, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'both' });
    turn.currentTime = Math.min(1000, Math.max(0, intoSecond));
  };
  const tick = (animate: boolean): void => {
    if (stopped) return;
    const remaining = remainingMs();
    renderTimeReadout(count, String(noticeSecondsRemaining(remaining)), animate);
    turnRing(remaining);
    const wait = msUntilNoticeSecondChanges(remaining);
    // A timer that fires a hair early re-reads the clock and re-arms instead of skipping a digit.
    if (wait !== null) timer = window.setTimeout(() => tick(true), Math.max(1, Math.ceil(wait)));
  };
  // Mounted first, so the notice paints above it.
  const stopScrim = scrim?.video ? showAutoTheaterScrim(scrim) : undefined;
  mountPlayerUi(overlay);
  // After mounting, so reduced motion is read from the UI host.
  tick(false);
  // The ring leaves while the digit keeps ticking; 0 is the last second, during which the ring clears.
  const stopExit = exitSpinner(spinner, { mode: 'deadline', remainingMs });
  return () => {
    stopped = true;
    stopExit();
    window.clearTimeout(timer);
    turn?.cancel();
    // Also settle any digit roll already in flight before discarding its DOM.
    renderTimeReadout(count, String(noticeSecondsRemaining(remainingMs())), false);
    overlay.remove();
    stopScrim?.();
  };
}
