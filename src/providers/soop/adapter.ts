import type { ContentAuthor } from '../../media-features/content-title';
import type { CaptionActivationResult, CaptionTrack, Chapter, MediaCapabilities, MediaFeaturesAdapter } from '../../media-features/types';
import { bylineAllowed, watchAuthorBylineSetting } from '../author-byline-setting';
import { observeProviderDom } from '../dom-watch';

import { parseSoopChapters, soopChaptersUrl } from './chapters';
import { soopRoute, soopRouteKey } from './dom';
import { readSoopAuthor, readSoopTitle, SOOP_TITLE_SELECTOR } from './page';
import { createSoopSettings } from './settings';

function currentRoute() {
  return soopRoute(new URL(window.location.href));
}

/**
 * SOOP: broadcast or recording title and streamer from the page, read again with every title publication. SOOP offers no subtitle track
 * list; the streamer's own on-screen captions are part of the stream.
 */
export class SoopAdapter implements MediaFeaturesAdapter {
  private chapters: { key: string; list: Chapter[] } | null = null;
  /** The byline's switches, read as the byline view reads them: the title names the streamer whenever it cannot. */
  private readonly byline = { global: watchAuthorBylineSetting(), settings: createSoopSettings() };

  constructor(private readonly video: HTMLVideoElement | null, private readonly fetchChapters: (url: string) => Promise<string | null>) {}

  mediaId(): string | null {
    const route = currentRoute();
    return route ? soopRouteKey(route) : null;
  }

  getTitle(): string | null {
    const route = currentRoute();
    return route ? readSoopTitle(document, route)?.title ?? null : null;
  }

  /**
   * The streamer, unless the byline names them: then the title row says it once, at its start. While either byline
   * switch is off (or not yet read) the streamer stays in the title, as it was before the byline.
   */
  getSubtitle(): string | null {
    const route = currentRoute();
    if (!route) return null;
    const named = bylineAllowed(this.byline.global, this.byline.settings, 'soop') && readSoopAuthor(document, route);
    return named ? null : readSoopTitle(document, route)?.subtitle ?? null;
  }

  getAuthors(): ContentAuthor[] | null {
    const route = currentRoute();
    const author = route && readSoopAuthor(document, route);
    return author ? [author] : null;
  }

  /** The title's page block, and the byline switches, which move the streamer between the title and the byline. */
  observeTitle(onChange: () => void): () => void {
    const stops = [
      observeProviderDom({ root: document, selector: SOOP_TITLE_SELECTOR, changed: onChange }),
      this.byline.global.subscribe(onChange),
      this.byline.settings.subscribe(onChange)
    ];
    return () => { for (const stop of stops) stop(); };
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
    this.byline.global.dispose();
    this.byline.settings.dispose();
  }
}
