import { publishHistoryChanges } from '../history-publication';

/** Window event published by the MAIN-world hook below, which isolated-world listeners can observe. */
export const PATREON_NAVIGATE_EVENT = 'theater-everywhere-patreon-navigate';

/** Patreon is a pushState SPA: a feed link opening a post fires no `popstate`. */
export function installPatreonNavigation(): void {
  publishHistoryChanges(PATREON_NAVIGATE_EVENT, 'theater-everywhere.patreon-history');
}
