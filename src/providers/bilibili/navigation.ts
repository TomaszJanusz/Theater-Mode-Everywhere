import { publishHistoryChanges } from '../history-publication';

/** Window event published by the MAIN-world hook below, which isolated-world listeners can observe. */
export const BILIBILI_NAVIGATE_EVENT = 'theater-everywhere-bilibili-navigate';

/** Both Bilibili sites use pushState routing: links that switch videos or parts fire no `popstate`. */
export function installBilibiliNavigation(): void {
  publishHistoryChanges(BILIBILI_NAVIGATE_EVENT, 'theater-everywhere.bilibili-history');
}
