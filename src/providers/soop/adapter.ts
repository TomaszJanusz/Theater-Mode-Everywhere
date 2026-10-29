import type { CaptionActivationResult, CaptionTrack, Chapter, MediaCapabilities, MediaFeaturesAdapter } from '../../media-features/types';
import { observeProviderDom } from '../dom-watch';

import { parseSoopChapters, soopChaptersUrl } from './chapters';
import { soopRoute, soopRouteKey } from './dom';
import { readSoopTitle } from './page';

function currentRoute() {
  return soopRoute(new URL(window.location.href));
}

/**
 * SOOP: broadcast or recording title and streamer from the page. SOOP offers no subtitle track
 * list; the streamer's own on-screen captions are part of the stream.
 */
export class SoopAdapter implements MediaFeaturesAdapter {
  private chapters: { key: string; list: Chapter[] } | null = null;

  constructor(private readonly video: HTMLVideoElement | null, private readonly fetchChapters: (url: string) => Promise<string | null>) {}

  mediaId(): string | null {
    const route = currentRoute();
    return route ? soopRouteKey(route) : null;
  }

  getTitle(): string | null {
    const route = currentRoute();
    return route ? readSoopTitle(document, route)?.title ?? null : null;
  }

  getSubtitle(): string | null {
    const route = currentRoute();
    return route ? readSoopTitle(document, route)?.subtitle ?? null : null;
  }

  observeTitle(onChange: () => void): () => void {
    return observeProviderDom({ root: document, selector: '#broadTitle, .broadcast_title, .nickname', changed: onChange });
  }

  async probe(): Promise<MediaCapabilities> {
    return { captions: false, chapters: (await this.getChapters()).length > 0, previews: false };
  }

  /** Recordings only; a live broadcast has no chapter list. One request per recording. */
  async getChapters(): Promise<Chapter[]> {
    const route = currentRoute();
    const url = route?.kind === 'vod' ? soopChaptersUrl(route.id) : null;
    const duration = this.video?.duration ?? Number.NaN;
    if (!route || !url || !Number.isFinite(duration)) return [];
    const key = `${soopRouteKey(route)}|${Math.round(duration)}`;
    if (this.chapters?.key === key) return this.chapters.list;
    const body = await this.fetchChapters(url);
    // The recording can change while the request is in flight.
    const now = currentRoute();
    if (!now || soopRouteKey(now) !== soopRouteKey(route)) return [];
    const list = body ? parseSoopChapters(body, duration) : [];
    this.chapters = { key, list };
    return list;
  }

  async reload(): Promise<void> {
    this.chapters = null;
  }

  invalidate(): void {
    this.chapters = null;
  }

  async listCaptionTracks(): Promise<CaptionTrack[]> {
    return [];
  }

  async activateCaptionTrack(id: string | null): Promise<CaptionActivationResult> {
    return id === null
      ? { status: 'off', delivery: 'none', cues: [] }
      : { status: 'failed', delivery: 'none', cues: [] };
  }

  dispose(): void {
    this.invalidate();
  }
}
