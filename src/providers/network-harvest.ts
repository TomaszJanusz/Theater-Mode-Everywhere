import { isCrunchyrollHost, isDisneyHost, isTencentHost, isTwitchHost, isYouTubeHost } from './hosts';
import { isYoutubeWatchJsonUrl } from '../media-features/parsers/youtube-heatmap';
import { crunchyrollMetadataRef, classifyCrunchyrollManifest } from '../media-features/parsers/crunchyroll';
import { crunchyrollCdnFile } from '../media-features/crunchyroll-cdn';
import { isAllowedMediaFetchUrl } from '../platform/media-url-policy';
import type { MediaProviderFlags } from '../media-features/provider-flags';

export function isTencentMetadataUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['h5vv.video.qq.com', 'h5vv6.video.qq.com', 'play.wetv.vip'].includes(url.hostname)
      && url.pathname === '/getvinfo';
  } catch { return false; }
}

export function shouldHarvestDisneyUrl(url: string): boolean {
  if (!url) return false;
  if (/\.(m3u8|mp4|m4s|ts|cmfa|cmfv|m4t|jpe?g|png|webp|gif|vtt|bif|js|css|woff2?)(\?|$)/i.test(url)) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return false;
    const host = parsed.hostname;
    if (['bamgrid.com', 'disney-plus.net'].some(domain => host === domain || host.endsWith(`.${domain}`))) return true;
    if (host === 'dssott.com' || host.endsWith('.dssott.com')) return /\.json$/i.test(parsed.pathname);
    return isDisneyHost(host) && /\/(playback|session|explore|api)\//i.test(parsed.pathname);
  } catch { return false; }
}

export function qualifiesYoutubeHeatmap(hostname: string, enabled: boolean, url: string, pageUrl: string): boolean {
  // Some host transports construct a Response without a URL. Only the YouTube
  // observer can use that fallback; it is never a reason to clone a fetch body.
  return enabled && isYouTubeHost(hostname) && (!url || isYoutubeWatchJsonUrl(url, pageUrl));
}

export type NetworkHarvestTarget = 'timedtext' | 'heatmap' | 'disney' | 'disney-bif'
  | 'tencent' | 'twitch' | 'twitch-storyboard' | 'crunchyroll' | 'crunchyroll-bif' | 'crunchyroll-url';

export type NetworkHarvestContext = {
  hostname: string;
  pageUrl: string;
  flags: Pick<MediaProviderFlags, 'youtube' | 'disney' | 'tencent' | 'twitch' | 'crunchyroll'>;
};

export function isDisneyBifUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'dssott.com' || url.hostname.endsWith('.dssott.com'))
      && !/DUB_CARD/i.test(value) && /\.bif$/i.test(url.pathname) && /thumbnails?\//i.test(value);
  } catch { return false; }
}

export function isTwitchGqlUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'gql.twitch.tv'; }
  catch { return false; }
}

/** Select one provider before touching the body. Endpoint rules stay provider-owned. */
export function qualifyNetworkHarvest(context: NetworkHarvestContext, url: string): NetworkHarvestTarget | null {
  const { hostname, pageUrl, flags } = context;
  if (isYouTubeHost(hostname) && flags.youtube) {
    if (isAllowedMediaFetchUrl({ provider: 'youtube', kind: 'caption-track', url }, pageUrl)) return 'timedtext';
    if (qualifiesYoutubeHeatmap(hostname, true, url, pageUrl)) return 'heatmap';
  }
  if (isDisneyHost(hostname) && flags.disney) {
    if (isDisneyBifUrl(url)) return 'disney-bif';
    // URL-less Response observers support host-created metadata Responses.
    if (!url || shouldHarvestDisneyUrl(url)) return 'disney';
  }
  if (isTencentHost(hostname) && flags.tencent && isTencentMetadataUrl(url)) return 'tencent';
  if (isTwitchHost(hostname) && flags.twitch) {
    if (!url || isTwitchGqlUrl(url)) return 'twitch';
    if (isAllowedMediaFetchUrl({ provider: 'twitch', kind: 'storyboard-json', url }, pageUrl)) return 'twitch-storyboard';
  }
  if (isCrunchyrollHost(hostname) && flags.crunchyroll) {
    const file = crunchyrollCdnFile(url);
    if (file?.kind === 'bif' && file.query === 't') return 'crunchyroll-bif';
    if (classifyCrunchyrollManifest(url, 'network') || file?.kind === 'ass') return 'crunchyroll-url';
    if (crunchyrollMetadataRef(url)) return 'crunchyroll';
  }
  return null;
}

export function harvestBodyFormat(target: NetworkHarvestTarget | null, type: XMLHttpRequestResponseType): 'text' | 'json' | 'binary' | 'blob-text' | null {
  if (!target || target === 'crunchyroll-url' || target === 'twitch-storyboard') return null;
  if (target === 'disney-bif' || target === 'crunchyroll-bif') {
    return type === 'arraybuffer' || (target === 'disney-bif' && type === 'blob') ? 'binary' : null;
  }
  if (type === 'json') return 'json';
  if (type === 'blob') return target === 'twitch' ? 'blob-text' : null;
  return type === '' || type === 'text' || type === 'arraybuffer' ? 'text' : null;
}

/** An endpoint can omit Content-Type, but an advertised media body is not JSON/text metadata. */
export function harvestFetchFormatMatches(target: NetworkHarvestTarget | null, contentType: string): boolean {
  if (!target) return false;
  if (target === 'disney-bif' || target === 'crunchyroll-bif') return true;
  return !/^(?:audio\/|video\/|image\/|font\/|text\/html\b)/i.test(contentType.trim());
}
