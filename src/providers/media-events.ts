import { isBilibiliIntlHost } from './hosts';
import { mediaProviderIntegrationEnabled } from '../media-features/provider-flags';
import { CRUNCHYROLL_HARVEST_EVENT } from './crunchyroll/main';
import { registeredEvents } from './runtime-registration';

/** Provider publication events consumed uniformly by the media controller. */
const PROVIDER_MEDIA_EVENTS = [
  'theater-everywhere-disney-harvest',
  'theater-everywhere-netflix-harvest',
  CRUNCHYROLL_HARVEST_EVENT
] as const;

export function observeProviderMediaChanges(onChange: () => void): () => void {
  // Registered events may target the document or the window; capture at the window sees both.
  const registered = registeredEvents('media');
  for (const event of PROVIDER_MEDIA_EVENTS) window.addEventListener(event, onChange);
  for (const event of registered) window.addEventListener(event, onChange, true);
  return () => {
    for (const event of PROVIDER_MEDIA_EVENTS) window.removeEventListener(event, onChange);
    for (const event of registered) window.removeEventListener(event, onChange, true);
  };
}

export function refreshProviderAfterElementReset(): boolean {
  // Bilibili.tv detaches the playing element before emptied; the replacement
  // need not emit durationchange, so reload metadata from the current route.
  return isBilibiliIntlHost() && mediaProviderIntegrationEnabled('bilibiliIntl');
}
