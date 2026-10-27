import { iqiyiChapters, type IqiyiSnapshot } from '../../media-features/parsers/iqiyi';
import { requestMediaProbe } from '../../media-features/probe';
import type { CaptionActivationResult, CaptionTrack, Chapter, MediaCapabilities, MediaFeaturesAdapter } from '../../media-features/types';
import { observeProviderDom } from '../dom-watch';

import { iqiyiCaptionOffItem, readIqiyiCaptionItems } from './captions';
import { iqiyiPlayId, readIqiyiTitle } from './page';

const FAILED: CaptionActivationResult = { status: 'failed', delivery: 'none', cues: [] };

/**
 * iq.com: title and episode from the play heading, host-delivered subtitles from the player's
 * own menu, and intro/outro windows from the page's play-info global.
 */
export class IqiyiAdapter implements MediaFeaturesAdapter {
  private snapshot: IqiyiSnapshot | null = null;
  private loadedFor: string | null = null;

  constructor(private readonly video: HTMLVideoElement | null = null) {}

  mediaId(): string | null {
    return iqiyiPlayId(window.location.pathname);
  }

  getTitle(): string | null {
    return readIqiyiTitle(document, window.location.pathname)?.title ?? null;
  }

  getSubtitle(): string | null {
    return readIqiyiTitle(document, window.location.pathname)?.subtitle ?? null;
  }

  observeTitle(onChange: () => void): () => void {
    return observeProviderDom({ root: document, selector: 'h1.intl-play-title, ul.intl-episodes-list', changed: onChange });
  }

  private async load(): Promise<void> {
    const id = this.mediaId();
    if (this.loadedFor === id && this.snapshot) return;
    const snapshot = (await requestMediaProbe()).iqiyi ?? null;
    // The page swaps its play-info after navigation; keep it only while this episode is still current.
    if (this.mediaId() !== id) return;
    this.snapshot = snapshot;
    this.loadedFor = id;
  }

  async probe(): Promise<MediaCapabilities> {
    await this.load();
    return { captions: readIqiyiCaptionItems(document).length > 0, chapters: (await this.getChapters()).length > 0, previews: false };
  }

  async listCaptionTracks(): Promise<CaptionTrack[]> {
    return readIqiyiCaptionItems(document).map((item) => item.track);
  }

  async activateCaptionTrack(id: string | null): Promise<CaptionActivationResult> {
    if (id === null) {
      const off = iqiyiCaptionOffItem(document);
      if (!off?.isConnected) return FAILED;
      off.click();
      return { status: 'off', delivery: 'none', cues: [] };
    }
    // Read the menu again: the host rebuilds it for each episode.
    const item = readIqiyiCaptionItems(document).find((candidate) => candidate.id === id);
    if (!item?.element.isConnected) return FAILED;
    item.element.click();
    return { status: 'active', delivery: 'host', cues: [] };
  }

  async getChapters(): Promise<Chapter[]> {
    await this.load();
    return iqiyiChapters(this.snapshot, this.video?.duration ?? NaN);
  }

  async reload(): Promise<void> {
    this.invalidate();
    await this.load();
  }

  invalidate(): void {
    this.snapshot = null;
    this.loadedFor = null;
  }

  dispose(): void {
    this.invalidate();
  }
}

