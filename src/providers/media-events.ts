import { mediaProviderIntegrationEnabled } from '../media-features/provider-flags';
import { CRUNCHYROLL_HARVEST_EVENT } from './crunchyroll/main';
import { providerRegistry, registeredEvents } from './runtime-registration';

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
  return providerRegistry.all().some(hooks => hooks.refreshOnElementReset && mediaProviderIntegrationEnabled(hooks.id));
}
