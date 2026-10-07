export const NETFLIX_NEXT_EVENT = 'theater-everywhere-netflix-next';
export const NETFLIX_NEXT_ACK_EVENT = 'theater-everywhere-netflix-next-ack';

const VIDEO_ID = /^\d{1,12}$/;

/** Ask the main world to play the next episode. The ack is synchronous across worlds. */
export function requestNetflixNextEpisode(videoId: string): boolean {
  if (!VIDEO_ID.test(videoId)) return false;
  let ok = false;
  const ack = (event: Event) => {
    if ((event as CustomEvent<unknown>).detail === `ok:${videoId}`) ok = true;
  };
  window.addEventListener(NETFLIX_NEXT_ACK_EVENT, ack);
  try {
    window.dispatchEvent(new CustomEvent(NETFLIX_NEXT_EVENT, { detail: videoId }));
  } finally {
    window.removeEventListener(NETFLIX_NEXT_ACK_EVENT, ack);
  }
  return ok;
}
