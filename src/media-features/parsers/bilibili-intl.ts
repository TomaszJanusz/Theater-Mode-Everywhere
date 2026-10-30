/**
 * Bilibili.tv's static media URL policy. The shared fetch allowlist applies it, so it stays here until the provider
 * registers its own admission; the provider's metadata imports it from here.
 */
const OGV_SUBTITLE_PATH = /^\/ogv\/subtitle\/[a-f0-9]{16,80}\.(?:ass|json)$/i;
/** Public upload captions, observed on `p.bstarstatic.com` without `auth_key`. */
const UGC_SUBTITLE_PATH = /^\/ugc\/subtitle\/\d{10,13}_[a-f0-9]{16,32}_subtitle-\d{10,16}\.(?:json|ass)$/i;
const SHOT_IMAGE_PATH = /^\/videoshot\/[a-z0-9]+(?:-\d+)?\.(?:jpe?g|png|webp)$/i;
const SHOT_BIN_PATH = /^\/videoshot\/[a-z0-9]+\.bin$/i;

/** Path as written, before `URL` resolves ".." or decodes "%2e%2e". */
function rawHttpsPath(value: string): string | null {
  const match = /^https:\/\/[^/?#\s]*([^?#]*)/i.exec(value.trim());
  if (!match?.[1]?.startsWith('/')) return null;
  return match[1];
}

function httpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Accepts a static URL only when the raw path already matches the allowlist.
 * Normalization must not turn `/ogv/subtitle/abcd/../<file>.ass` into a hit.
 */
function allowedStaticUrl(value: unknown, hostname: string, pathPattern: RegExp, query: 'none' | 'auth'): string | null {
  if (typeof value !== 'string' || !value || value.length > 2000) return null;
  const rawPath = rawHttpsPath(value);
  const url = httpsUrl(value);
  if (!rawPath || !url || url.hostname !== hostname || rawPath !== url.pathname || !pathPattern.test(rawPath)) return null;
  if (query === 'none') {
    if (url.search) return null;
  } else if (url.search && !/^\?auth_key=[\w.~-]{1,200}$/.test(url.search)) return null;
  return url.href;
}

/**
 * Episode files are signed objects on `s.bstarstatic.com/ogv/subtitle/`.
 * Upload files are on `p.bstarstatic.com/ugc/subtitle/` and may omit `auth_key`.
 * Any other query is rejected. The raw path must already match, before `URL` resolves `..`.
 */
export function bilibiliIntlSubtitleUrl(value: unknown): string | null {
  return allowedStaticUrl(value, 's.bstarstatic.com', OGV_SUBTITLE_PATH, 'auth')
    || allowedStaticUrl(value, 'p.bstarstatic.com', UGC_SUBTITLE_PATH, 'auth');
}

export function bilibiliIntlShotImageUrl(value: unknown): string | null {
  return allowedStaticUrl(value, 'pic.bstarstatic.com', SHOT_IMAGE_PATH, 'none');
}

export function bilibiliIntlShotBinUrl(value: unknown): string | null {
  return allowedStaticUrl(value, 'pic.bstarstatic.com', SHOT_BIN_PATH, 'none');
}
