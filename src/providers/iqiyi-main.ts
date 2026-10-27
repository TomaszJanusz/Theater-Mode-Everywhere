import { normalizeIqiyiPlayInfo, type IqiyiSnapshot } from '../media-features/parsers/iqiyi';
import { mediaProviderIntegrationEnabled } from '../media-features/provider-flags';

import { isIqiyiHost } from './hosts';
import { installHistoryPublication } from './navigation/history-publication';

export type { IqiyiSnapshot } from '../media-features/parsers/iqiyi';

/** Window event published by the MAIN-world hook below, which isolated-world listeners can observe. */
export const IQIYI_NAVIGATE_EVENT = 'theater-everywhere-iqiyi-navigate';

export function iqiyiIntegrationEnabled(): boolean {
  return isIqiyiHost() && mediaProviderIntegrationEnabled('iqiyi');
}

/** iq.com is a pushState SPA: choosing an episode fires no `popstate`. */
export function installIqiyiNavigation(): void {
  if (iqiyiIntegrationEnabled()) installHistoryPublication(IQIYI_NAVIGATE_EVENT, 'theater-everywhere.iqiyi-history');
}

/** The page's own play-info global; nothing is requested. */
export function readIqiyiSnapshot(): IqiyiSnapshot | null {
  if (!iqiyiIntegrationEnabled()) return null;
  try {
    return normalizeIqiyiPlayInfo((window as unknown as { __playerdata__?: { __dash?: unknown } }).__playerdata__?.__dash);
  } catch {
    return null;
  }
}
