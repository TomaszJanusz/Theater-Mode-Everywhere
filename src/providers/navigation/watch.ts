import { providerOffAttribute } from '../../media-features/provider-flags';
import type { PlaylistNavState } from '../../playlist-nav';
import { observeProviderDom } from '../dom-watch';
import { providerRegistry } from '../runtime-registration';

const SURFACES = ['button.vjs-previous-video', 'button.vjs-next-video', '[data-testid="button-previous-video"]',
  '[data-testid="button-next-video"]', 'button.prev_button', 'button.next_button',
  'button[data-href]', 'a[href*="video="]'].join(',');

/** One live read supplies labels, previews and frame availability together. */
export function subscribePlaylistNavigation(root: Document | ShadowRoot, read: () => PlaylistNavState,
  listener: (state: PlaylistNavState) => void): () => void {
  const doc = root instanceof Document ? root : root.ownerDocument;
  const registered = providerRegistry.all().filter(hooks => hooks.navigation);
  const caches = registered.flatMap(hooks => hooks.navigation?.retainCache?.(doc) ?? []);
  const owned = registered.flatMap(hooks => hooks.navigation?.surfaces ?? []).join(', ');
  const players = registered.flatMap(hooks => hooks.navigation?.players ?? []).join(', ');
  const paints = ['video', ...registered.flatMap(hooks => hooks.navigation?.paints ?? [])].join(', ');
  const controls = ['button, a', ...registered.flatMap(hooks => hooks.navigation?.controls ?? [])].join(', ');
  const stop = observeProviderDom({ root, selector: [SURFACES, owned, players].filter(Boolean).join(','), pollWhenEmpty: true,
    // Host controls are measured with the frame's other readers; the listener paints afterwards.
    changed: () => { const state = read(); return () => listener(state); },
    structureChanged: () => { for (const cache of caches) cache.invalidate(); },
    relevant: record => {
      const element = record.target instanceof Element ? record.target : record.target.parentElement;
      if (owned && element?.closest(owned)) return true;
      if (players && element?.matches(players)) {
        return record.type === 'childList' || record.attributeName === 'class' || record.attributeName === 'data-videoid';
      }
      if (element?.closest(paints)) return false;
      // Host clock and scrubber paint are unrelated to persistent navigation.
      return Boolean(element?.closest(controls)
        || (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element)));
    },
    flags: registered.map(hooks => providerOffAttribute(hooks.id)),
    events: ['theater-everywhere-playlist-nav', ...registered.flatMap(hooks => [...hooks.events?.domChange ?? [], ...hooks.events?.media ?? []])] });
  return () => { stop(); for (const cache of caches) cache.release(); };
}
