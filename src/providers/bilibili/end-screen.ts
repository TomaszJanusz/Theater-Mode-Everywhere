import type { EndScreenSource } from '../../core/end-screen';
import { providerOffAttribute } from '../../media-features/provider-flags';
import { mountEndScreenSettings, type EndScreenSnapshot, type SuggestionSource } from '../end-screen-view';

import { BILIBILI_ENDING_PANEL, readBilibiliAutoplay } from './autoplay';
import { readBilibiliEndTiles } from './end-screen-model';
import { BILIBILI_NAVIGATE_EVENT } from './history';
import { BILIBILI_PLAYER_SELECTOR } from './navigation';
import { createBilibiliSettings } from './settings';
import { bilibiliVideoIdentity } from './watch-playback';

/** Per-controls lifetime; nothing is read until Bilibili has filled its ending panel. */
export function createBilibiliEndScreen(element: HTMLElement): EndScreenSource & SuggestionSource {
  const settings = createBilibiliSettings();
  void settings.ready.catch(error => { console.error('Error loading recommendations:', error); });
  const doc = element.ownerDocument;
  const root = element.closest<HTMLElement>(BILIBILI_PLAYER_SELECTOR);
  const video = element instanceof HTMLVideoElement ? element : null;
  let disposed = false;
  let visit = 0;
  let snapshot: EndScreenSnapshot | null = null;
  let dirty = true;
  const off = providerOffAttribute('bilibili');
  const identity = () => {
    const id = bilibiliVideoIdentity(new URL(doc.location.href));
    return !disposed && !doc.documentElement.hasAttribute(off) && root?.isConnected && root.contains(element) ? id : null;
  };
  // Bilibili's own countdown owns the picture; its Play now and Cancel are the service actions.
  const hostEndsPlayback = () => Boolean(identity() && root && readBilibiliAutoplay(root));
  const read = (): EndScreenSnapshot | null => {
    const id = identity();
    if (!id || !root || hostEndsPlayback()) return null;
    const mediaId = JSON.stringify([id, visit, video?.currentSrc]);
    if (dirty || snapshot?.mediaId !== mediaId) {
      snapshot = { mediaId, items: readBilibiliEndTiles(root, doc).map(entry => entry.item) };
      dirty = false;
    }
    return snapshot.items.length ? snapshot : null;
  };
  let stop = () => {};
  let refresh = () => {};
  return {
    mount(container, scope, label) {
      refresh = mountEndScreenSettings(container, { read, activate }, { label, scope, settings, provider: 'bilibili' });
      scope.add(() => { refresh = () => {}; });
    },
    read, hostEndsPlayback,
    activate,
    subscribe(changed) {
      stop();
      const update = () => { dirty = true; changed(); refresh(); };
      // Bilibili switches parts and videos without a page load: the history hook publishes each route change.
      const navigate = () => { visit++; snapshot = null; update(); };
      const win = doc.defaultView;
      win?.addEventListener(BILIBILI_NAVIGATE_EVENT, navigate);
      win?.addEventListener('popstate', navigate);
      // Only the ending panel: the rest of the player mutates constantly (danmaku, progress).
      const observer = new MutationObserver(update);
      const panel = root?.querySelector(BILIBILI_ENDING_PANEL);
      if (panel) observer.observe(panel, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] });
      observer.observe(doc.documentElement, { attributes: true, attributeFilter: [off] });
      stop = () => {
        observer.disconnect();
        win?.removeEventListener(BILIBILI_NAVIGATE_EVENT, navigate);
        win?.removeEventListener('popstate', navigate);
      };
      return stop;
    },
    dispose() { disposed = true; snapshot = null; stop(); settings.dispose(); }
  };

  function activate(id: string, mediaId: string): boolean {
    if (!settings.loaded || !settings.values.bilibili?.showRecommendations || !root || read()?.mediaId !== mediaId) return false;
    // Bilibili's own tile does the switch; a missing tile degrades without leaving theater.
    const entry = readBilibiliEndTiles(root, doc).find(entry => entry.item.id === id);
    if (!entry?.element.isConnected) return false;
    entry.element.click();
    return true;
  }
}
