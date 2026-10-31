import type { DisposableScope } from '../../core/disposable-scope';

import type { SuggestionSource } from './end-screen-model';
import css from './end-screen.css?inline';

/** One activation path: a real button gives Enter/Space and pointer the same host command. */
export function renderEndScreen(source: SuggestionSource, label: string, scope: DisposableScope): HTMLElement | null {
  const snapshot = source.read();
  if (!snapshot?.items.length) return null;
  const grid = document.createElement('div');
  grid.className = 'theater-end-screen';
  grid.setAttribute('role', 'region');
  grid.setAttribute('aria-label', label);
  const style = document.createElement('style');
  style.textContent = css;
  grid.append(style);
  for (const item of snapshot.items.slice(0, 3)) {
    const tile = document.createElement('button');
    tile.className = 'theater-end-screen-tile';
    tile.type = 'button';
    const picture = document.createElement('span');
    picture.className = 'theater-end-screen-picture';
    // The duration is repeated after the visible text for the accessible name, title first.
    picture.setAttribute('aria-hidden', 'true');
    if (item.thumbnailUrl) {
      const image = document.createElement('img');
      image.src = item.thumbnailUrl;
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      picture.append(image);
    }
    const text = (value: string | undefined, className: string, parent: HTMLElement) => {
      if (!value) return;
      const node = document.createElement('span');
      node.className = className;
      node.textContent = value;
      parent.append(node);
    };
    text(item.durationText, 'theater-end-screen-duration', picture);
    tile.append(picture);
    text(item.title, 'theater-end-screen-title', tile);
    text(item.channel, 'theater-end-screen-channel', tile);
    text(item.meta, 'theater-end-screen-meta', tile);
    text(item.durationText, 'theater-sr-only', tile);
    tile.addEventListener('click', event => {
      if (event.detail) tile.blur();
      // Removed nodes can still receive a queued click; the provider checks the visit again too.
      if (scope.isDisposed || !tile.isConnected || source.read()?.mediaId !== snapshot.mediaId) return;
      if (!source.activate(item.id, snapshot.mediaId)) grid.remove();
    });
    grid.append(tile);
  }
  return grid;
}
