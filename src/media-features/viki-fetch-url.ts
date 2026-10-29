/** Minimal URL admission shared with the background broker, which has no provider registry. */
function httpsUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port ? parsed : null;
  } catch {
    return null;
  }
}

/** The page's own subtitle file: `https://api.viki.io/v4/videos/<id>/subtitles/<lang>.vtt`, which the page lists and also loads as `auth_subtitles`. */
export function isVikiCaptionUrl(url: string, videoId?: string): boolean {
  const parsed = httpsUrl(url);
  const match = parsed && parsed.hostname === 'api.viki.io'
    ? /^\/v4\/videos\/(\d+v)\/(?:auth_)?subtitles\/[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?\.vtt$/.exec(parsed.pathname) : null;
  return Boolean(match) && (videoId === undefined || match![1] === videoId);
}

/** The page's own timeline preview list: `https://manifest-viki.viki.io/v1/streams/<id>/preview.vtt`. */
export function isVikiPreviewUrl(url: string, videoId?: string): boolean {
  const parsed = httpsUrl(url);
  const match = parsed && parsed.hostname === 'manifest-viki.viki.io'
    ? /^\/v1\/streams\/(\d+v)\/preview\.vtt$/.exec(parsed.pathname) : null;
  return Boolean(match) && (videoId === undefined || match![1] === videoId);
}
