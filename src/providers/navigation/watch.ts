import { observeProviderDom } from '../dom-watch';
import type { PlaylistNavState } from '../../playlist-nav';
import { invalidateDisneyPlayNextHosts, retainDisneyPlayNextHosts } from '../disney/play-next';

const SURFACES = ['.ytp-prev-button', '.ytp-next-button', 'ytd-playlist-panel-renderer',
  'button.vjs-previous-video', 'button.vjs-next-video', '[data-testid="button-previous-video"]',
  '[data-testid="button-next-video"]', 'button.prev_button', 'button.next_button',
  '.bpx-player-ctrl-prev', '.bpx-player-ctrl-next', '.player-mobile-control-btn-next-episode',
  '.txp_btn_next_u', '.txp_btn_next', '[data-role="wetv-player-ctrl-next"]',
  'button[data-href]', 'a[href*="video="]', '.watch-video [data-uia="player"]',
  'disney-web-player', 'controls-overlay', 'main-app-controls-overlay'].join(',');

/** One live read supplies labels, previews and frame availability together. */
export function subscribePlaylistNavigation(root: Document | ShadowRoot, read: () => PlaylistNavState,
  listener: (state: PlaylistNavState) => void): () => void {
  const doc = root instanceof Document ? root : root.ownerDocument;
  const releaseHosts = retainDisneyPlayNextHosts(doc);
  const stop = observeProviderDom({ root, selector: SURFACES, pollWhenEmpty: true,
    // Host controls are measured with the frame's other readers; the listener paints afterwards.
    changed: () => { const state = read(); return () => listener(state); },
    structureChanged: () => invalidateDisneyPlayNextHosts(root instanceof Document ? root : root.ownerDocument),
    relevant: record => {
      const element = record.target instanceof Element ? record.target : record.target.parentElement;
      if (element?.closest('ytd-playlist-panel-renderer')) return true;
      if (element?.matches('.watch-video [data-uia="player"], disney-web-player, controls-overlay, main-app-controls-overlay')) {
        return record.type === 'childList' || record.attributeName === 'class' || record.attributeName === 'data-videoid';
      }
      if (element?.closest('video, .inner, .progress-ring__circle')) return false;
      // Host clock and scrubber paint are unrelated to persistent navigation.
      return Boolean(element?.closest('button, a, play-next, .bpx-player-ctrl-prev, .bpx-player-ctrl-next, '
        + '.player-mobile-control-btn-next-episode, .txp_btn_next_u, .txp_btn_next, [data-role="wetv-player-ctrl-next"]')
        || (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element)));
    },
    events: ['theater-everywhere-playlist-nav', 'theater-everywhere-youtube-harvest',
      'theater-everywhere-netflix-harvest', 'theater-everywhere-disney-harvest', 'theater-everywhere-disney-play-next-changed'] });
  return () => { stop(); releaseHosts(); };
}
