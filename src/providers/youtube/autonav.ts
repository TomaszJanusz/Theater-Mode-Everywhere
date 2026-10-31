import { usableServiceControl } from '../native-service-actions';

/** Recorded delhi-modern DOM: YouTube owns the 8 -> 0 digits, cancellation and navigation. */
export function readYouTubeAutonav(root: HTMLElement) {
  if (!root.classList.contains('ended-mode') || !root.classList.contains('countdown-running')
    || root.matches('.ad-showing, .ad-interrupting, .ytp-autonav-endscreen-cancelled-state')) return null;
  const panel = root.querySelector<HTMLElement>('.ytp-autonav-endscreen-countdown-overlay');
  const play = panel?.querySelector<HTMLAnchorElement>('a.ytp-autonav-endscreen-upnext-play-button[href]');
  const cancel = panel?.querySelector<HTMLButtonElement>('button.ytp-autonav-endscreen-upnext-cancel-button');
  if (!play || !cancel || !usableServiceControl(play) || !usableServiceControl(cancel)) return null;
  const text = panel?.querySelector('.ytp-autonav-endscreen-upnext-header-countdown-number')?.textContent?.trim() ?? '';
  const remaining = /^\d+$/.test(text) ? Number(text) : null;
  return { play, cancel, remaining };
}

/** Progress follows only observed native digits, including a native pause; it never runs a second clock. */
export function countdownProgress(remaining: number | null, maximum: number): number | undefined {
  return remaining !== null && maximum > 0 ? Math.max(0, Math.min(1, 1 - remaining / maximum)) : undefined;
}
