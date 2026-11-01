import { isDisneyHost } from './hosts';

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

export function isDisneyBifUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'dssott.com' || url.hostname.endsWith('.dssott.com'))
      && !/DUB_CARD/i.test(value) && /\.bif$/i.test(url.pathname) && /thumbnails?\//i.test(value);
  } catch { return false; }
}

/** `disney-bif` is a binary target (BIF thumbnail sets); `disney` is playback and catalog metadata. */
export function qualifyDisneyHarvest(url: string, enabled: boolean): 'disney' | 'disney-bif' | null {
  if (!enabled) return null;
  if (isDisneyBifUrl(url)) return 'disney-bif';
  // URL-less Response observers support host-created metadata Responses.
  return !url || shouldHarvestDisneyUrl(url) ? 'disney' : null;
}
