import type { CaptionActivationResult, CaptionTrack, MediaCapabilities, MediaFeaturesAdapter } from '../../media-features/types';
import { observeProviderDom } from '../dom-watch';

import { iqiyiPlayId, readIqiyiTitle } from './page';

/**
 * iq.com paints its subtitles in its own player, with no text tracks or public caption source,
 * so subtitles stay host-owned and this adapter supplies the title only.
 */
export class IqiyiAdapter implements MediaFeaturesAdapter {
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

  async probe(): Promise<MediaCapabilities> {
    return { captions: false, chapters: false, previews: false };
  }

  async listCaptionTracks(): Promise<CaptionTrack[]> {
    return [];
  }

  async activateCaptionTrack(id: string | null): Promise<CaptionActivationResult> {
    return id === null
      ? { status: 'off', delivery: 'none', cues: [] }
      : { status: 'failed', delivery: 'none', cues: [] };
  }

  dispose(): void {}
}
