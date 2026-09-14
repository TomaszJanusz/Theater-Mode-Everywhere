const MAX_CAPTION_BYTES = 2 * 1024 * 1024;

export type MediaFetchRequest = {
  provider: 'youtube' | 'patreon' | 'twitch' | 'disney';
  kind: 'caption-track' | 'storyboard-vtt' | 'storyboard-json';
  url: string;
};

export type MediaFetchResult = {
  ok: boolean;
  body?: string;
  contentType?: string;
  error?: string;
};

function hostnameAllowed(hostname: string, allowed: RegExp[]): boolean {
  return allowed.some((pattern) => pattern.test(hostname));
}

function parseHttpsUrl(url: string, base?: string): URL | null {
  try {
    const parsed = base ? new URL(url, base) : new URL(url);
    if (parsed.protocol !== 'https:') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isAllowedMediaFetchUrl(request: MediaFetchRequest, base?: string): boolean {
  const parsed = parseHttpsUrl(request.url, base);
  if (!parsed) return false;

  if (request.provider === 'youtube' && request.kind === 'caption-track') {
    const hostOk = hostnameAllowed(parsed.hostname, [
      /^(www\.)?youtube\.com$/i,
      /^youtu\.be$/i,
      /^(www\.)?youtube-nocookie\.com$/i
    ]);
    const pathOk = /timedtext/i.test(parsed.pathname) || /\/api\/timedtext/i.test(parsed.pathname);
    return hostOk && pathOk;
  }

  if (request.provider === 'patreon' && (request.kind === 'storyboard-vtt' || request.kind === 'storyboard-json')) {
    const hostOk = parsed.hostname.replace(/^www\./i, '').toLowerCase() === 'image.mux.com';
    const pathOk = request.kind === 'storyboard-json'
      ? /\/[^/]+\/storyboard\.json$/i.test(parsed.pathname)
      : /\/[^/]+\/storyboard\.vtt$/i.test(parsed.pathname);
    return hostOk && pathOk;
  }

  if (request.provider === 'patreon' && request.kind === 'caption-track') {
    const hostOk = parsed.hostname.replace(/^www\./i, '').toLowerCase() === 'stream.mux.com';
    return hostOk && /\/[^/]+\/text\/[^/]+\.vtt$/i.test(parsed.pathname);
  }

  if (request.provider === 'twitch' && request.kind === 'storyboard-json') {
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const hostOk = host === 'vod-secure.twitch.tv'
      || host === 'vod-storyboards.twitch.tv'
      || host === 'static-cdn.jtvnw.net'
      || /^d[a-z0-9]{6,}\.cloudfront\.net$/i.test(host);
    return hostOk && /\/storyboards\/[^/?#]*info\.json$/i.test(parsed.pathname);
  }

  if (request.provider === 'twitch' && request.kind === 'caption-track') {
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const hostOk = host === 'captions.twitch.tv' || host.endsWith('.captions.twitch.tv');
    return hostOk && /\.vtt$/i.test(parsed.pathname);
  }

  if (request.provider === 'disney') {
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    const dssott = host === 'dssott.com' || host.endsWith('.dssott.com');
    if (!dssott) return false;
    if (request.kind === 'caption-track') {
      if (/\.vtt$/i.test(parsed.pathname) || /SUBTITLE_1_WEBVTT/i.test(request.url)) return true;
      return /\.m3u8$/i.test(parsed.pathname) && (
        /una-ctr-all/i.test(request.url)
        || /composite_[^/?#]+_(NORMAL|FORCED|SDH)_/i.test(request.url)
      );
    }
    if (request.kind === 'storyboard-json') {
      if (/DUB_CARD/i.test(request.url)) return false;
      return /\.bif$/i.test(parsed.pathname) && /thumbnails?\//i.test(request.url);
    }
    return false;
  }

  return false;
}

export function assertSafeRedirect(finalUrl: string, request: MediaFetchRequest): boolean {
  return isAllowedMediaFetchUrl({ ...request, url: finalUrl });
}

const CLASSIFY_PROVIDERS: MediaFetchRequest['provider'][] = ['youtube', 'patreon', 'twitch', 'disney'];
const CLASSIFY_KINDS: MediaFetchRequest['kind'][] = ['caption-track', 'storyboard-vtt', 'storyboard-json'];

export function classifyMediaFetchUrl(url: string, base?: string): MediaFetchRequest | null {
  for (const provider of CLASSIFY_PROVIDERS) {
    for (const kind of CLASSIFY_KINDS) {
      const request: MediaFetchRequest = { provider, kind, url };
      if (isAllowedMediaFetchUrl(request, base)) return request;
    }
  }
  return null;
}

export function isAllowedPageFetchUrl(url: string, base?: string): boolean {
  const classified = classifyMediaFetchUrl(url, base);
  if (!classified) return false;
  // Twitch storyboards are harvested from network; page fetch stays caption/BIF scoped.
  if (classified.provider === 'twitch' && classified.kind === 'storyboard-json') return false;
  return true;
}

export function isAllowedBrokerFetchUrl(url: string): boolean {
  const classified = classifyMediaFetchUrl(url);
  if (!classified) return false;
  // Disney BIF is binary and larger than the text broker budget.
  if (classified.provider === 'disney' && classified.kind === 'storyboard-json') return false;
  return true;
}

export { MAX_CAPTION_BYTES };
