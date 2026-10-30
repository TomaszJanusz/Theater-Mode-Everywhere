import { crunchyrollCdnFile } from '../media-features/crunchyroll-cdn';
import { crunchyrollMetadataRef, classifyCrunchyrollManifest } from '../media-features/parsers/crunchyroll';
import type { MediaProviderFlags } from '../media-features/provider-flags';

import { isCrunchyrollHost, isDisneyHost, isTencentHost } from './hosts';

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

export type NetworkHarvestTarget = 'disney' | 'disney-bif'
  | 'tencent' | 'crunchyroll' | 'crunchyroll-bif' | 'crunchyroll-url';

export type NetworkHarvestContext = {
  hostname: string;
  flags: Pick<MediaProviderFlags, 'disney' | 'tencent' | 'crunchyroll'>;
};

export function isDisneyBifUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'dssott.com' || url.hostname.endsWith('.dssott.com'))
      && !/DUB_CARD/i.test(value) && /\.bif$/i.test(url.pathname) && /thumbnails?\//i.test(value);
  } catch { return false; }
}

/** Select one provider before touching the body. Endpoint rules stay provider-owned. */
export function qualifyNetworkHarvest(context: NetworkHarvestContext, url: string): NetworkHarvestTarget | null {
  const { hostname, flags } = context;
  if (isDisneyHost(hostname) && flags.disney) {
    if (isDisneyBifUrl(url)) return 'disney-bif';
    // URL-less Response observers support host-created metadata Responses.
    if (!url || shouldHarvestDisneyUrl(url)) return 'disney';
  }
  if (isTencentHost(hostname) && flags.tencent && isTencentMetadataUrl(url)) return 'tencent';
  if (isCrunchyrollHost(hostname) && flags.crunchyroll) {
    const file = crunchyrollCdnFile(url);
    if (file?.kind === 'bif' && file.query === 't') return 'crunchyroll-bif';
    if (classifyCrunchyrollManifest(url, 'network') || file?.kind === 'ass') return 'crunchyroll-url';
    if (crunchyrollMetadataRef(url)) return 'crunchyroll';
  }
  return null;
}

/** `provider` stands for a registered provider's target: text or JSON metadata, never binary. */
export type HarvestFormatTarget = NetworkHarvestTarget | 'provider';

export function harvestBodyFormat(target: HarvestFormatTarget | null, type: XMLHttpRequestResponseType): 'text' | 'json' | 'binary' | null {
  if (!target || target === 'crunchyroll-url') return null;
  if (target === 'disney-bif' || target === 'crunchyroll-bif') {
    return type === 'arraybuffer' || (target === 'disney-bif' && type === 'blob') ? 'binary' : null;
  }
  if (type === 'json') return 'json';
  if (type === 'blob') return null;
  return type === '' || type === 'text' || type === 'arraybuffer' ? 'text' : null;
}

/** An endpoint can omit Content-Type, but an advertised media body is not JSON/text metadata. */
export function harvestFetchFormatMatches(target: HarvestFormatTarget | null, contentType: string): boolean {
  if (!target) return false;
  if (target === 'disney-bif' || target === 'crunchyroll-bif') return true;
  return !/^(?:audio\/|video\/|image\/|font\/|text\/html\b)/i.test(contentType.trim());
}
