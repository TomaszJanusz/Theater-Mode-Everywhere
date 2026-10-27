import { mediaProviderIntegrationEnabled } from '../media-features/provider-flags';

import { isSoopHost } from './hosts';
import { installHistoryPublication } from './navigation/history-publication';

/** Window event published by the MAIN-world hook below, which isolated-world listeners can observe. */
export const SOOP_NAVIGATE_EVENT = 'theater-everywhere-soop-navigate';

export function soopIntegrationEnabled(): boolean {
  return isSoopHost() && mediaProviderIntegrationEnabled('soop');
}

/** The player pages can change route with pushState, which fires no `popstate`. */
export function installSoopNavigation(): void {
  if (soopIntegrationEnabled()) {
    installHistoryPublication(SOOP_NAVIGATE_EVENT, 'theater-everywhere.soop-history');
  }
}
