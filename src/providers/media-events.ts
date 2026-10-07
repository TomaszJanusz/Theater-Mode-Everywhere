import { isBilibiliIntlHost } from './hosts';
import { mediaProviderIntegrationEnabled } from '../media-features/provider-flags';
import { CRUNCHYROLL_HARVEST_EVENT } from './crunchyroll/main';

/** Provider publication events consumed uniformly by the media controller. */
const PROVIDER_MEDIA_EVENTS = [
  'theater-everywhere-youtube-harvest',
  'theater-everywhere-twitch-harvest',
  'theater-everywhere-disney-harvest',
  'theater-everywhere-netflix-harvest',
  CRUNCHYROLL_HARVEST_EVENT
] as const;

export function observeProviderMediaChanges(onChange: () => void): () => void {
  document.addEventListener('yt-navigate-finish', onChange);
  for (const event of PROVIDER_MEDIA_EVENTS) window.addEventListener(event, onChange);
  return () => {
    document.removeEventListener('yt-navigate-finish', onChange);
    for (const event of PROVIDER_MEDIA_EVENTS) window.removeEventListener(event, onChange);
  };
}

export function refreshProviderAfterElementReset(): boolean {
  // Bilibili.tv detaches the playing element before emptied; the replacement
  // need not emit durationchange, so reload metadata from the current route.
  return isBilibiliIntlHost() && mediaProviderIntegrationEnabled('bilibiliIntl');
}
