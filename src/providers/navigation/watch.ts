import { providerOffAttribute } from '../../media-features/provider-flags';
import type { PlaylistNavState } from '../../playlist-nav';
import { invalidateDisneyPlayNextHosts, retainDisneyPlayNextHosts } from '../disney/play-next';
import { observeProviderDom } from '../dom-watch';
import { providerRegistry } from '../runtime-registration';

const SURFACES = ['button.vjs-previous-video', 'button.vjs-next-video', '[data-testid="button-previous-video"]',
  '[data-testid="button-next-video"]', 'button.prev_button', 'button.next_button',
  '.txp_btn_next_u', '.txp_btn_next', '[data-role="wetv-player-ctrl-next"]',
  'button[data-href]', 'a[href*="video="]', '.watch-video [data-uia="player"]',
  'disney-web-player', 'controls-overlay', 'main-app-controls-overlay'].join(',');

/** One live read supplies labels, previews and frame availability together. */
export function subscribePlaylistNavigation(root: Document | ShadowRoot, read: () => PlaylistNavState,
  listener: (state: PlaylistNavState) => void): () => void {
  const doc = root instanceof Document ? root : root.ownerDocument;
  const releaseHosts = retainDisneyPlayNextHosts(doc);
  const registered = providerRegistry.all().filter(hooks => hooks.navigation);
  const owned = registered.flatMap(hooks => hooks.navigation?.surfaces ?? []).join(', ');
  const stop = observeProviderDom({ root, selector: [SURFACES, owned].filter(Boolean).join(','), pollWhenEmpty: true,
    // Host controls are measured with the frame's other readers; the listener paints afterwards.
    changed: () => { const state = read(); return () => listener(state); },
    structureChanged: () => invalidateDisneyPlayNextHosts(root instanceof Document ? root : root.ownerDocument),
    relevant: record => {
      const element = record.target instanceof Element ? record.target : record.target.parentElement;
      if (owned && element?.closest(owned)) return true;
      if (element?.matches('.watch-video [data-uia="player"], disney-web-player, controls-overlay, main-app-controls-overlay')) {
        return record.type === 'childList' || record.attributeName === 'class' || record.attributeName === 'data-videoid';
      }
      if (element?.closest('video, .inner, .progress-ring__circle')) return false;
      // Host clock and scrubber paint are unrelated to persistent navigation.
      return Boolean(element?.closest('button, a, play-next, '
        + '.txp_btn_next_u, .txp_btn_next, [data-role="wetv-player-ctrl-next"]')
        || (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element)));
    },
    flags: registered.map(hooks => providerOffAttribute(hooks.id)),
    events: ['theater-everywhere-playlist-nav', 'theater-everywhere-netflix-harvest', 'theater-everywhere-disney-harvest',
      'theater-everywhere-disney-play-next-changed', ...registered.flatMap(hooks => [...hooks.events?.domChange ?? [], ...hooks.events?.media ?? []])] });
  return () => { stop(); releaseHosts(); };
}
