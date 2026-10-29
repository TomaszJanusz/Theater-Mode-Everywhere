import { publishHistoryChanges } from '../history-publication';

/** Window event published by the MAIN-world hook below, which isolated-world listeners can observe. */
export const TWITCH_NAVIGATE_EVENT = 'theater-everywhere-twitch-navigate';

/** Twitch is a pushState SPA: opening a VOD from a channel or directory page fires no `popstate`. */
export function installTwitchNavigation(): void {
  publishHistoryChanges(TWITCH_NAVIGATE_EVENT, 'theater-everywhere.twitch-history');
}
