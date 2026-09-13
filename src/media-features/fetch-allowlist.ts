const MAX_CAPTION_BYTES = 2 * 1024 * 1024;

export type MediaFetchRequest = {
  provider: 'youtube' | 'patreon' | 'twitch';
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

export function isAllowedMediaFetchUrl(request: MediaFetchRequest): boolean {
  let parsed: URL;
  try {
    parsed = new URL(request.url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;

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

  return false;
}

export function assertSafeRedirect(finalUrl: string, request: MediaFetchRequest): boolean {
  return isAllowedMediaFetchUrl({ ...request, url: finalUrl });
}

export { MAX_CAPTION_BYTES };
