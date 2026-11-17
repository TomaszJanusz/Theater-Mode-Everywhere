import type { PlaylistPanelSource } from '../../core/playlist-panel';
import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import type { observeProviderDom } from '../dom-watch';
import { isYouTubeHost } from '../hosts';
import { mountPlaylistView } from '../playlist-panel-view';

import { YOUTUBE_PAGE_EVENTS } from './events';
import { queryYouTubePlaylist, goToYouTubePlaylistItem } from './playlist-panel-bridge';

/** The watch page's own panel; the miniplayer keeps a copy of it that belongs to no theater player. */
const WATCH_PANEL = 'ytd-watch-flexy ytd-playlist-panel-renderer';

/**
 * The playlist of YouTube's watch player, read from the page's own playlist panel. Every list YouTube shows there
 * has the same model; lists differ in the count (none for endless mixes) and in how much of the list YouTube has
 * loaded around the current item, which is all the panel lists.
 */
export function youtubePlaylistPanel(
  element: HTMLElement,
  observe: typeof observeProviderDom
): PlaylistPanelSource | undefined {
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  if (!view || !isYouTubeHost(view.location.hostname)) return undefined;
  const ownPlayer = () => {
    const player = doc.getElementById('movie_player');
    return player?.contains(element) ? player : null;
  };
  return {
    // A few lookups on each navigation refresh: the list data itself is read only while the panel is open.
    available() {
      if (!mediaProviderIntegrationEnabled('youtube')) return false;
      const url = new URL(view.location.href);
      if (url.pathname !== '/watch' || !url.searchParams.get('list')) return false;
      const watch = ownPlayer()?.closest<HTMLElement>('ytd-watch-flexy');
      if (!watch || watch.hidden) return false;
      // YouTube keeps the element and hides it when the list is unavailable to this viewer (Watch later signed out).
      const panel = watch.querySelector<HTMLElement>('ytd-playlist-panel-renderer');
      return Boolean(panel && !panel.hidden);
    },
    mount(panel, scope, close) {
      mountPlaylistView({
        read: () => ownPlayer() && mediaProviderIntegrationEnabled('youtube') ? queryYouTubePlaylist(doc) : null,
        activate(key) {
          if (!ownPlayer()) return false;
          // MAIN finds the key's item in the live model and navigates with YouTube's own link, keeping the list.
          const listed = queryYouTubePlaylist(doc)?.items.find(item => item.key === key);
          if (!listed?.playable || listed.current) return false;
          goToYouTubePlaylistItem(doc, key);
          return true;
        },
        // The panel re-renders its rows for a new current item; SPA navigation replaces the model.
        subscribe: changed => observe({
          root: doc,
          selector: WATCH_PANEL,
          changed: () => { changed(); },
          events: YOUTUBE_PAGE_EVENTS,
          // Every change of the list is a mutation inside the panel or one of YouTube's page events.
          needsFallback: () => false
        })
      }, panel, scope, close);
    }
  };
}
