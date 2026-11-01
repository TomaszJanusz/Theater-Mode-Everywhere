import { PROVIDER_CATALOG } from '../providers/catalog';
import { descriptorHomeUrl } from '../providers/descriptor-hosts';
import { isCrunchyrollHost, isYouTubeHost } from '../providers/hosts';

/** Resolve the service homepage, including hosts used only for embedded players. */
export function serviceHomeUrl(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const declared = descriptorHomeUrl(PROVIDER_CATALOG, url.hostname);
    if (declared) return declared;
    if (isYouTubeHost(url.hostname)) return 'https://www.youtube.com/';
    if (isCrunchyrollHost(url.hostname)) return 'https://www.crunchyroll.com/';
    return `${url.origin}/`;
  } catch {
    return null;
  }
}
