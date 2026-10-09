export const YOUTUBE_QUEUE_QUERY = 'theater-everywhere-youtube-queue-query';
export const YOUTUBE_QUEUE_GO = 'theater-everywhere-youtube-queue-go';
export const YOUTUBE_QUEUE_SNAPSHOT = 'theater-everywhere-youtube-queue';

export type YouTubeQueueStep =
  | { kind: 'unknown' | 'boundary' }
  | { kind: 'item'; key: string; title: string; imageUrl: string };

export type YouTubeQueueSnapshot = {
  requestId: string;
  pageHref: string;
  videoId: string;
  previous: YouTubeQueueStep;
  next: YouTubeQueueStep;
};

let requestCounter = 0;

/** Strings cross Firefox's MAIN/isolated-world boundary without object access errors. */
export function queryYouTubeQueue(doc: Document): YouTubeQueueSnapshot | null {
  const view = doc.defaultView;
  if (!view) return null;
  const requestId = `${Date.now()}:${++requestCounter}`;
  view.dispatchEvent(new CustomEvent(YOUTUBE_QUEUE_QUERY, { detail: requestId }));
  const text = doc.getElementById(YOUTUBE_QUEUE_SNAPSHOT)?.textContent;
  if (!text || text.length > 12_000) return null;
  try {
    const data = JSON.parse(text) as YouTubeQueueSnapshot;
    if (!data || data.requestId !== requestId || data.pageHref !== view.location.href) return null;
    if (typeof data.videoId !== 'string' || !validStep(data.previous) || !validStep(data.next)) return null;
    return data;
  } catch {
    return null;
  }
}

export function requestYouTubeQueueStep(doc: Document, key: string): void {
  doc.defaultView?.dispatchEvent(new CustomEvent(YOUTUBE_QUEUE_GO, { detail: key }));
}

function validStep(step: YouTubeQueueStep): boolean {
  if (!step || typeof step !== 'object') return false;
  if (step.kind === 'unknown' || step.kind === 'boundary') return true;
  return step.kind === 'item'
    && typeof step.key === 'string' && step.key.length > 0 && step.key.length <= 4000
    && typeof step.title === 'string' && step.title.length <= 180
    && typeof step.imageUrl === 'string' && step.imageUrl.length <= 2000;
}
