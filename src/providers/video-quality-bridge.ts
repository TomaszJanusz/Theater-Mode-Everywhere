import type { VideoQualityLevel, VideoQualitySource, VideoQualityState } from '../core/video-quality';
import { mediaProviderIntegrationEnabled, type MediaProviderId } from '../media-features/provider-flags';
import { publishHiddenJson } from '../platform/hidden-json';

/**
 * Host quality APIs live on page objects only MAIN can reach. They cross worlds the way YouTube's audio tracks do: a
 * string-only query dispatched on the bound `<video>`, which MAIN answers synchronously in hidden JSON, a selection
 * request MAIN revalidates against the live player before acting, and a payload-free change ping. Dispatching on the
 * element lets MAIN resolve the exact player that owns it. Page scripts see and can forge all of this, so both sides
 * validate what they receive; a forged answer can only misdescribe the page's own player.
 */
export const VIDEO_QUALITY_QUERY = 'theater-everywhere-quality-query';
export const VIDEO_QUALITY_SELECT = 'theater-everywhere-quality-select';
export const VIDEO_QUALITY_CHANGE = 'theater-everywhere-quality-change';
export const VIDEO_QUALITY_SNAPSHOT = 'theater-everywhere-quality';
export const VIDEO_QUALITY_RESULT = 'theater-everywhere-quality-result';

const MAX_LEVELS = 40;
const MAX_DETAIL_CHARS = 1000;
const MAX_SNAPSHOT_CHARS = 20_000;
/** Media events after which the levels, the playing level or the item itself may have changed. */
const MEDIA_EVENTS = ['loadedmetadata', 'resize', 'emptied'] as const;

const boundedString = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const isRequestId = (value: unknown): value is string => typeof value === 'string' && /^[\w:-]{1,80}$/.test(value);

/** The picture height a host label such as `1080p60 HDR` or `720p` names; null for anything else. */
export function heightFromLabel(label: string): number | null {
  const match = /^(\d{3,4})p/.exec(label.trim());
  return match ? Number(match[1]) : null;
}

/**
 * Normalizes a host's (or a forged) quality description: bounded strings, unique ids, positive heights, highest first,
 * and `fixed`/`playing` only when they name a listed level. Fewer than two levels offer no choice, so they read as none.
 */
export function normalizeVideoQuality(value: unknown): VideoQualityState | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (!boundedString(data.mediaId, 200) || !Array.isArray(data.levels) || data.levels.length > MAX_LEVELS) return null;
  const levels: VideoQualityLevel[] = [];
  for (const raw of data.levels as unknown[]) {
    if (!raw || typeof raw !== 'object') return null;
    const { id, label, height } = raw as Record<string, unknown>;
    if (!boundedString(id, 100) || typeof label !== 'string' || !Number.isInteger(height) || (height as number) < 1 || (height as number) > 10_000) return null;
    const text = label.trim().slice(0, 60);
    if (!text || levels.some(level => level.id === id)) continue;
    levels.push({ id, label: text, height: height as number });
  }
  if (levels.length < 2) return null;
  levels.sort((a, b) => b.height - a.height);
  const listed = (id: unknown) => typeof id === 'string' && levels.some(level => level.id === id) ? id : null;
  return { mediaId: data.mediaId, levels, fixed: listed(data.fixed), playing: listed(data.playing) };
}

type QueryDetail = { provider: MediaProviderId; requestId: string };
type SelectDetail = QueryDetail & { mediaId: string; level: string | null };

function parseDetail(raw: unknown, provider: MediaProviderId): Partial<SelectDetail> | null {
  if (typeof raw !== 'string' || raw.length > MAX_DETAIL_CHARS) return null;
  try {
    const data = JSON.parse(raw) as Partial<SelectDetail> | null;
    return data && data.provider === provider && isRequestId(data.requestId) ? data : null;
  } catch {
    return null;
  }
}

/** MAIN's view of one host's quality API. Both calls receive the exact element the theater is bound to. */
export interface VideoQualityHost {
  /** The current description, in any shape `normalizeVideoQuality` accepts; null while no pick would reach the content. */
  read(video: HTMLVideoElement): unknown;
  /** Applies `level` (null: Auto); true once the host took it. Called only after the item and level were revalidated. */
  select(video: HTMLVideoElement, level: string | null): boolean;
  /** Reports host quality changes the media events do not show, for players it can reach. Installed once. */
  observe?(changed: () => void): void;
}

const ping = () => window.dispatchEvent(new CustomEvent(VIDEO_QUALITY_CHANGE));

function targetVideo(event: Event): HTMLVideoElement | null {
  const target = event.composedPath()[0];
  return target instanceof HTMLVideoElement ? target : null;
}

/** MAIN: answers this provider's queries and selections while its integration is enabled. */
export function installQualityBridge(provider: MediaProviderId, host: VideoQualityHost): void {
  const read = (video: HTMLVideoElement) => {
    try {
      return mediaProviderIntegrationEnabled(provider) ? normalizeVideoQuality(host.read(video)) : null;
    } catch {
      return null; // Host APIs can throw mid-navigation.
    }
  };
  window.addEventListener(VIDEO_QUALITY_QUERY, (event: Event) => {
    const detail = parseDetail((event as CustomEvent<unknown>).detail, provider);
    const video = targetVideo(event);
    if (!detail || !video) return;
    publishHiddenJson(VIDEO_QUALITY_SNAPSHOT, { requestId: detail.requestId, state: read(video) });
  }, true);
  window.addEventListener(VIDEO_QUALITY_SELECT, (event: Event) => {
    const detail = parseDetail((event as CustomEvent<unknown>).detail, provider);
    const video = targetVideo(event);
    if (!detail || !video || typeof detail.mediaId !== 'string' || (detail.level !== null && typeof detail.level !== 'string')) return;
    // Revalidate what the isolated world saw: the same item, still outside an ad, still offering the level.
    const state = read(video);
    const offered = state?.mediaId === detail.mediaId && (detail.level === null || state.levels.some(level => level.id === detail.level));
    let ok = false;
    try {
      ok = offered && host.select(video, detail.level ?? null);
    } catch {
      ok = false;
    }
    publishHiddenJson(VIDEO_QUALITY_RESULT, { requestId: detail.requestId, ok });
    if (ok) ping();
  }, true);
  host.observe?.(() => {
    if (mediaProviderIntegrationEnabled(provider)) ping();
  });
}

let requestCounter = 0;
const nextRequestId = () => `${Date.now()}:${++requestCounter}`;

function parseAnswer(text: string | null | undefined, requestId: string): unknown {
  if (!text || text.length > MAX_SNAPSHOT_CHARS) return undefined;
  try {
    const data = JSON.parse(text) as { requestId?: unknown } & Record<string, unknown>;
    return data && data.requestId === requestId ? data : undefined;
  } catch {
    return undefined;
  }
}

/** Isolated: the bridged source for the theater's bound video; none for a host player that is not a `<video>`. */
export function bridgedVideoQuality(provider: MediaProviderId, element: HTMLElement): VideoQualitySource | undefined {
  if (!(element instanceof HTMLVideoElement)) return undefined;
  const video = element;
  const ask = (type: string, detail: Record<string, unknown>, answer: string) => {
    const requestId = nextRequestId();
    video.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail: JSON.stringify({ ...detail, provider, requestId }) }));
    return parseAnswer(video.ownerDocument.getElementById(answer)?.textContent, requestId) as Record<string, unknown> | undefined;
  };
  return {
    read: () => normalizeVideoQuality(ask(VIDEO_QUALITY_QUERY, {}, VIDEO_QUALITY_SNAPSHOT)?.state),
    select: (level, mediaId) => ask(VIDEO_QUALITY_SELECT, { mediaId, level }, VIDEO_QUALITY_RESULT)?.ok === true,
    subscribe(changed) {
      const view = video.ownerDocument.defaultView;
      view?.addEventListener(VIDEO_QUALITY_CHANGE, changed);
      for (const type of MEDIA_EVENTS) video.addEventListener(type, changed);
      return () => {
        view?.removeEventListener(VIDEO_QUALITY_CHANGE, changed);
        for (const type of MEDIA_EVENTS) video.removeEventListener(type, changed);
      };
    }
  };
}
