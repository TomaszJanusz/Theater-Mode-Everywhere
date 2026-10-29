import { MAX_CAPTION_BYTES } from '../platform/bounded-body';
import { PROVIDER_CATALOG } from '../providers/catalog';
import { matchesMediaFetchRules, type MediaFetchRule } from '../providers/media-fetch-rules';
import { providerRegistry } from '../providers/runtime-registration';

import { isCrunchyrollCaptionFileUrl } from './crunchyroll-cdn';
import { bilibiliIntlSubtitleUrl } from './parsers/bilibili-intl';
import { isMuxCaptionUrl, isMuxStoryboardUrl } from './parsers/mux-storyboard';
import type { MediaProviderId } from './provider-flags';
import { isYoutubeTimedtextUrl } from './youtube-caption-url';

export type MediaFetchRequest = {
  provider: MediaProviderId;
  kind: 'caption-track' | 'storyboard-vtt' | 'storyboard-json' | 'chapters';
  url: string;
};

export type MediaFetchResult = {
  ok: boolean;
  body?: string;
  contentType?: string;
  error?: string;
};

/** JSON subtitle objects on hdslb. AI tracks often have no .json suffix. */
function isBilibiliSubtitlePath(pathname: string): boolean {
  if (pathname.includes('\\') || pathname.includes('%') || pathname.split('/').includes('..')) return false;
  return /^\/bfs\/(?:ai_)?subtitle(?:\/[A-Za-z0-9_-]+)*\/[A-Za-z0-9_-]+(?:\.json)?$/i.test(pathname);
}

/** Path as written, before URL normalization drops ".." or decodes "%2e%2e". */
function rawHttpsPath(url: string): string | null {
  const match = /^https:\/\/[^/?#]*([^?#]*)/i.exec(url.trim());
  if (!match?.[1]?.startsWith('/')) return null;
  return match[1];
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

  if (request.provider === 'crunchyroll' && request.kind === 'caption-track') {
    return isCrunchyrollCaptionFileUrl(request.url);
  }

  if (request.provider === 'tencent' && request.kind === 'caption-track') {
  return !parsed.username && !parsed.password && !parsed.port
    && ['cffaws.wetvinfo.com', 'subtitle.wetvinfo.com', 'subtitle.tc.qq.com', 'subtitlebk.apdcdn.tc.qq.com'].includes(parsed.hostname)
    && /\.(vtt|srt)$/i.test(parsed.pathname);
}

  if (request.provider === 'bilibiliIntl' && request.kind === 'caption-track') {
    return bilibiliIntlSubtitleUrl(request.url) !== null;
  }

  if (request.provider === 'bilibili' && request.kind === 'caption-track') {
    const rawPath = rawHttpsPath(request.url);
    return !parsed.username && !parsed.password && !parsed.port
      && (parsed.hostname === 'hdslb.com' || parsed.hostname.endsWith('.hdslb.com'))
      && rawPath !== null
      && rawPath === parsed.pathname
      && isBilibiliSubtitlePath(rawPath);
  }

  if (request.provider === 'youtube' && request.kind === 'caption-track') return isYoutubeTimedtextUrl(request.url, base);

  // The background broker has no provider registry, so Patreon's Mux rules stay here for its fallback fetch.
  if (request.provider === 'patreon' && (request.kind === 'storyboard-vtt' || request.kind === 'storyboard-json')) return isMuxStoryboardUrl(parsed, request.kind);

  if (request.provider === 'patreon' && request.kind === 'caption-track') return isMuxCaptionUrl(parsed);

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

  const descriptor: { id: string; mediaFetch?: readonly MediaFetchRule[] } | undefined = PROVIDER_CATALOG.find(item => item.id === request.provider);
  if (descriptor?.mediaFetch && matchesMediaFetchRules(descriptor.mediaFetch, request, base)) return true;
  return providerRegistry.get(request.provider)?.allowsMediaFetch?.(request, base) ?? false;
}

export function assertSafeRedirect(finalUrl: string, request: MediaFetchRequest): boolean {
  return isAllowedMediaFetchUrl({ ...request, url: finalUrl });
}

const CLASSIFY_PROVIDERS: MediaFetchRequest['provider'][] = ['youtube', 'twitch', 'disney', 'bilibili', 'bilibiliIntl', 'tencent', 'crunchyroll', ...PROVIDER_CATALOG.map(item => item.id)];
// Netflix stays off this list. Public playback renders subtitles in the host
// player and did not expose a caption or storyboard URL safe to fetch.
const CLASSIFY_KINDS: MediaFetchRequest['kind'][] = ['caption-track', 'storyboard-vtt', 'storyboard-json', 'chapters'];

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
