import { publishHiddenJson } from '../../platform/hidden-json';
import { netflixVideoId } from '../../media-features/parsers/netflix-page';
import { NETFLIX_ACTION_SNAPSHOT_ID } from './action-bridge';
import { netflixWatchId, readNetflixPlayerAppApi, seekNetflixSession, selectNetflixSession } from './session';

let labeledVideoId: string | null = null;
let introLabel = '';

/** Netflix unmounts its chrome on idle. Keep only an observed native intro
 * label, with availability and activation checked against the active clock. */
function liveIntro(root: HTMLElement | null) {
  const watchId = netflixWatchId(window.location.pathname);
  const player = selectNetflixSession(readNetflixPlayerAppApi(), root, watchId);
  const videoId = netflixVideoId(player?.getMovieId?.());
  if (videoId !== labeledVideoId) {
    labeledVideoId = videoId;
    introLabel = '';
  }
  if (!watchId || !root || !player || !player.isReady?.()) return null;
  const native = root.querySelector<HTMLButtonElement>('button[data-uia="player-skip-intro"]');
  if (native && (native.disabled || native.hidden || native.getAttribute('aria-disabled') === 'true'
      || getComputedStyle(native).display === 'none')) return null;
  if (native && !native.disabled && native.getAttribute('aria-disabled') !== 'true') {
    introLabel = (native.textContent || native.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }
  if (!introLabel) return null;
  try {
    // In the signed-in watch API, skip_credits is the opening credits window.
    const codes = player.getTimeCodes?.();
    const window = Array.isArray(codes) ? codes.slice(0, 40).find(code => code?.type === 'skip_credits') : null;
    const start = window?.startOffsetMs;
    const end = window?.endOffsetMs;
    const current = player.getCurrentTime?.();
    if (![start, end, current].every(value => typeof value === 'number' && Number.isFinite(value))) return null;
    if (start! < 0 || end! <= start! || end! > 86400000 || current! < start! || current! >= end!) return null;
    return { id: `intro:${videoId}:${Math.round(start!)}:${Math.round(end!)}`, label: introLabel, end: end!, player };
  } catch { return null; }
}

export function syncNetflixTimedAction(root: HTMLElement | null): void {
  const action = liveIntro(root);
  publishHiddenJson(NETFLIX_ACTION_SNAPSHOT_ID, action ? { id: action.id, label: action.label, updatedAt: Date.now() } : null);
}

export function activateNetflixTimedAction(root: HTMLElement | null, id: string): boolean {
  const action = liveIntro(root);
  if (!action || action.id !== id) return false;
  return seekNetflixSession(action.player, action.end / 1000, action.player.isPaused?.() !== true);
}
