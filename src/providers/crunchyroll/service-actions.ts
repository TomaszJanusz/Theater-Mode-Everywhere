import type { ServiceAction, ServiceActionSource } from '../../core/service-actions';
import { crunchyrollMediaId, type CrunchyrollSkipWindow } from '../../media-features/parsers/crunchyroll';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { isCrunchyrollHost } from '../hosts';
import { readCrunchyrollSkipWindows } from './skip-windows';

const tokens = new WeakMap<HTMLElement, string>();
let tokenSerial = 0;
const NEXT_ANNOUNCE_SECONDS = 10;

export type CrunchyrollServiceActionHooks = {
  enabled?: () => boolean;
  host?: () => boolean;
  href?: () => string;
  document?: Document;
};

type Playback = {
  currentTime: number;
  duration: number;
  ended: boolean;
  paused: boolean;
  seek: (time: number) => boolean;
};

type LiveAction = ServiceAction & { element?: HTMLElement; seek?: (time: number) => boolean; end?: number };

/**
 * The skip pill stays mounted after its window and after the control bar
 * auto-hides. Opacity and aria-hidden follow the bar, so a visible pill with
 * a leftover label is not a live skip. The CTA requires a published window
 * that contains the playhead. The native click no-ops while the bar is
 * hidden, so that path seeks to the window end. The toolbar next control is
 * always mounted when another episode exists; it is announced only over
 * credits, the preview, or the final seconds. Its handler still runs when
 * the bar has faded, so that action is clicked whenever the node itself is
 * displayed.
 */
export function createCrunchyrollServiceActions(hooks: CrunchyrollServiceActionHooks = {}): ServiceActionSource {
  const enabled = hooks.enabled ?? (() => mediaProviderIntegrationEnabled('crunchyroll'));
  const host = hooks.host ?? (() => isCrunchyrollHost());
  const href = hooks.href ?? (() => window.location.href);
  const doc = hooks.document ?? document;

  const live = (): LiveAction[] => {
    if (!allowed(enabled, host)) return [];
    const mediaId = watchMediaId(href());
    const root = playerRoot(doc);
    if (!mediaId || !root) return [];
    const playback = readPlayback(root);
    if (!playback || !Number.isFinite(playback.currentTime)) return [];
    const windows = readCrunchyrollSkipWindows(doc, mediaId);
    const found: LiveAction[] = [];
    const skip = skipPill(root);
    const label = skip ? controlLabel(skip) : '';
    const window = activeWindow(windows, playback.currentTime);
    if (skip && label && window && present(skip)) {
      found.push({
        id: `crunchyroll:skip|${mediaId}|${window.type}|${window.start}|${window.end}|${elementToken(skip)}`,
        label,
        element: skip,
        end: window.end,
        seek: playback.seek
      });
    }
    const next = root.querySelector<HTMLElement>('[data-testid="next-episode-button"]');
    const nextLabel = next ? controlLabel(next) : '';
    if (next && nextLabel && present(next) && announceNext(playback, windows)) {
      found.push({
        id: `crunchyroll:next|${mediaId}|${elementToken(next)}`,
        label: nextLabel,
        element: next
      });
    }
    return found;
  };

  return {
    read: () => live().map(({ element: _element, seek: _seek, end: _end, ...action }) => action),
    activate(id: string): boolean {
      const action = live().find(item => item.id === id);
      if (!action?.element || !present(action.element)) return false;
      // Skip's own handler ignores the click while the bar is hidden.
      if (action.end !== undefined && action.seek && !acceptsClick(action.element)) {
        return action.seek(action.end);
      }
      action.element.click();
      return true;
    }
  };
}

function playerRoot(doc: Document): HTMLElement | null {
  const root = doc.querySelector('#player-container');
  if (!(root instanceof HTMLElement) || !root.isConnected || !root.querySelector('video')) return null;
  return root;
}

function readPlayback(root: ParentNode): Playback | null {
  const video = root.querySelector('video');
  if (!(video instanceof HTMLVideoElement)) return null;
  return {
    currentTime: video.currentTime,
    duration: video.duration,
    ended: video.ended,
    paused: video.paused,
    seek(time: number) {
      const paused = video.paused;
      try {
        video.currentTime = time;
      } catch {
        return false;
      }
      if (paused) {
        try { video.pause(); } catch { /* The seek still stands. */ }
      }
      return video.seeking || Math.abs(video.currentTime - time) < 1.5;
    }
  };
}

function skipPill(root: ParentNode): HTMLElement | null {
  const controls = root.querySelector('[data-testid="player-controls-root"]');
  if (!controls) return null;
  // Toolbar icons carry data-testid. The skip pill is the text button the player
  // keeps mounted, including while its own bar has faded it out.
  const buttons = [...controls.querySelectorAll<HTMLElement>('button')].filter(button =>
    !button.getAttribute('data-testid') && (button.textContent || '').replace(/\s+/g, ' ').trim());
  return buttons.find(button => button.className.includes('kat:self-end')) || buttons[0] || null;
}

function activeWindow(windows: readonly CrunchyrollSkipWindow[], time: number): CrunchyrollSkipWindow | null {
  const hits = windows.filter(window => time >= window.start && time < window.end);
  hits.sort((left, right) => right.start - left.start);
  return hits[0] || null;
}

function announceNext(playback: Playback, windows: readonly CrunchyrollSkipWindow[]): boolean {
  if (playback.ended) return true;
  const time = playback.currentTime;
  if (windows.some(window =>
    (window.type === 'credits' || window.type === 'preview') && time >= window.start && time < window.end)) {
    return true;
  }
  const duration = playback.duration;
  return Number.isFinite(duration) && duration > NEXT_ANNOUNCE_SECONDS
    && time >= duration - NEXT_ANNOUNCE_SECONDS && time < duration;
}

function watchMediaId(href: string): string | null {
  try {
    const url = new URL(href, 'https://www.crunchyroll.com');
    const watch = url.pathname.match(/\/watch\/([A-Za-z0-9]{9})(?:\/|$)/i);
    const embed = url.pathname.match(/\/embed\/([A-Za-z0-9]{9})(?:\/|$)/i);
    return crunchyrollMediaId(watch?.[1] || embed?.[1]);
  } catch {
    return null;
  }
}

function allowed(enabled: () => boolean, host: () => boolean): boolean {
  try {
    return enabled() === true && host() === true;
  } catch {
    return false;
  }
}

function present(element: HTMLElement): boolean {
  return element.isConnected && !disabled(element) && displayed(element);
}

function acceptsClick(element: HTMLElement): boolean {
  if (!present(element)) return false;
  if (element.getAttribute('aria-hidden') === 'true' || element.tabIndex < 0) return false;
  try {
    const style = getComputedStyle(element);
    if (style.pointerEvents === 'none' || Number.parseFloat(style.opacity) === 0) return false;
  } catch {
    return false;
  }
  return true;
}

function disabled(element: HTMLElement): boolean {
  if (element.getAttribute('aria-disabled') === 'true') return true;
  try {
    return element.matches(':disabled');
  } catch {
    return true;
  }
}

function displayed(element: HTMLElement): boolean {
  let node: HTMLElement | null = element;
  while (node) {
    if (node.hidden) return false;
    try {
      if (getComputedStyle(node).display === 'none') return false;
    } catch {
      return false;
    }
    node = node.parentElement;
  }
  return true;
}

function controlLabel(element: HTMLElement): string {
  const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
  const aria = (element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  return (text || aria).slice(0, 80);
}

function elementToken(element: HTMLElement): string {
  let token = tokens.get(element);
  if (!token) {
    tokenSerial += 1;
    token = `e${tokenSerial}`;
    tokens.set(element, token);
  }
  return token;
}
