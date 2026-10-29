import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { publishHistoryChanges } from '../history-publication';

import { normalizeIqiyiPlayInfo, type IqiyiSnapshot } from './play-info';

/** Window event published by the MAIN-world hook below, which isolated-world listeners can observe. */
export const IQIYI_NAVIGATE_EVENT = 'theater-everywhere-iqiyi-navigate';

/** iq.com is a pushState SPA: choosing an episode fires no `popstate`. */
export function installIqiyiNavigation(): void {
  if (mediaProviderIntegrationEnabled('iqiyi')) publishHistoryChanges(IQIYI_NAVIGATE_EVENT, 'theater-everywhere.iqiyi-history');
}

/** The page's own play-info global; nothing is requested. */
export function readIqiyiSnapshot(): IqiyiSnapshot | null {
  if (!mediaProviderIntegrationEnabled('iqiyi')) return null;
  try {
    return normalizeIqiyiPlayInfo((window as unknown as { __playerdata__?: { __dash?: unknown } }).__playerdata__?.__dash);
  } catch {
    return null;
  }
}
