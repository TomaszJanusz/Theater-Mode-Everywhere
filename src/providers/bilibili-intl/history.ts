import { publishHistoryChanges } from '../history-publication';

/** Window event published by the MAIN-world hook below, which isolated-world listeners can observe. */
export const INTL_NAVIGATE_EVENT = 'theater-everywhere-bilibili-intl-navigate';

/** Bilibili.tv uses pushState routing: links that switch videos or episodes fire no `popstate`. */
export function installIntlNavigation(): void {
  publishHistoryChanges(INTL_NAVIGATE_EVENT, 'theater-everywhere.bilibili-intl-history');
}
