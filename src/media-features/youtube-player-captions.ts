import { encodeYoutubeCaptions, type YoutubeCaptionsRequest } from '../protocol/page-requests';

import { youtubeRecord } from './parsers/youtube-player-response';

export const MEDIA_YT_CAPTIONS_EVENT = 'theater-everywhere-youtube-captions';
export const MEDIA_YT_CAPTIONS_RESULT_EVENT = 'theater-everywhere-youtube-captions-result';

/** Correlates this channel's own requests; results are dispatched on its own result event. */
let requestId = 0;

export type YoutubeCaptionsOptions = Omit<YoutubeCaptionsRequest, 'requestId'>;

export function requestYoutubePlayerCaptions(options: YoutubeCaptionsOptions, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const id = ++requestId;
    let settled = false;
    const timer = window.setTimeout(() => finish(false), timeoutMs);

    const onResult = (event: Event) => {
      const detail = youtubeRecord((event as CustomEvent<unknown>).detail);
      if (!detail || detail.requestId !== id) return;
      finish(detail.ok === true);
    };

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener(MEDIA_YT_CAPTIONS_RESULT_EVENT, onResult as EventListener);
      resolve(ok);
    };

    window.addEventListener(MEDIA_YT_CAPTIONS_RESULT_EVENT, onResult as EventListener);
    window.dispatchEvent(new CustomEvent(MEDIA_YT_CAPTIONS_EVENT, {
      detail: encodeYoutubeCaptions({ ...options, requestId: id })
    }));
  });
}
