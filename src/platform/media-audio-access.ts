/**
 * Whether Web Audio would hear this element. A MediaElementSource on DRM media
 * or on cross-origin media fetched without CORS outputs silence, and routing
 * the element through it cannot be undone, so those must never be connected.
 */
export type MediaAudioAccess = 'open' | 'needs-cors' | 'protected';

export function mediaAudioAccess(video: HTMLMediaElement, pageOrigin: string): MediaAudioAccess {
  if (video.mediaKeys) return 'protected';
  if (video.srcObject) return 'open';
  const url = video.currentSrc || video.src;
  if (!url) return 'needs-cors';
  let parsed: URL;
  try {
    parsed = new URL(url, pageOrigin);
  } catch {
    return 'needs-cors';
  }
  if (parsed.protocol === 'blob:' || parsed.protocol === 'data:') return 'open';
  if (parsed.origin === pageOrigin) return 'open';
  // Metadata proves the CORS request succeeded; a failed one falls back
  // without the attribute.
  return video.crossOrigin !== null && video.readyState >= 1 ? 'open' : 'needs-cors';
}
