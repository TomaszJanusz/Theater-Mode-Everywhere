import { exitSpinner } from './spinner-exit';
import { mountPlayerUi } from './root';
import { HUD_PLATE_CLASS } from './hud';
import { renderKbdText } from './kbd-text';
import { t } from './messages';
import { msUntilNoticeSecondChanges, noticeSecondsRemaining } from './auto-theater-intent';
import { renderTimeReadout } from './time-readout';

export const AUTO_THEATER_NOTICE_CLASS = 'theater-auto-notice';

/**
 * Corner notice for a pending automatic theater entry. It reuses the caption
 * loading plate and spinner; unlike HUDs it takes clicks, but never focus.
 * The role=status region announces itself on insertion; the seconds counter inside the
 * spinner is decorative (aria-hidden), so ticks are never announced. The counter is
 * derived from `remainingMs`, the intent's own clock, and re-armed only at each change
 * of the displayed second. Returns idempotent cleanup.
 */
export function showAutoTheaterNotice(
  paintOverlay: (element: HTMLElement) => void,
  onCancel: () => void,
  remainingMs: () => number
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
  const tick = (animate: boolean): void => {
    if (stopped) return;
    const remaining = remainingMs();
    renderTimeReadout(count, String(noticeSecondsRemaining(remaining)), animate);
    const wait = msUntilNoticeSecondChanges(remaining);
    // A timer that fires a hair early re-reads the clock and re-arms instead of skipping a digit.
    if (wait !== null) timer = window.setTimeout(() => tick(true), Math.max(1, Math.ceil(wait)));
  };
  tick(false);
  mountPlayerUi(overlay);
  const stopExit = exitSpinner(spinner, {
    mode: 'deadline', remainingMs,
    onStart: () => {
      window.clearTimeout(timer);
      // Hold the final digit throughout the shrink, without starting another roll.
      renderTimeReadout(count, String(noticeSecondsRemaining(remainingMs())), false);
    }
  });
  return () => {
    stopped = true;
    stopExit();
    window.clearTimeout(timer);
    // Also settle any digit roll already in flight before discarding its DOM.
    renderTimeReadout(count, String(noticeSecondsRemaining(remainingMs())), false);
    overlay.remove();
  };
}
