import type { DisposableScope } from '../../core/disposable-scope';
import { languageRuntime } from '../../i18n-runtime';
import type { ProviderSettingsStore } from '../settings';

import type { SuggestionSource } from './end-screen-model';
import css from './end-screen.css?inline';
import { recommendationsLabel } from './settings';

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

/** The switch outlives its tiles, so a saved off choice is reversible on the same curtain. */
export function mountEndScreenSettings(
  container: HTMLElement, source: SuggestionSource,
  { label, scope, settings }: { label: string; scope: DisposableScope; settings: ProviderSettingsStore }
): () => void {
  const style = document.createElement('style');
  style.textContent = css;
  // A line of its own under the tiles centres the switch on the stage; only the label itself takes clicks.
  const row = document.createElement('div');
  row.className = 'theater-recommendations-row';
  const control = document.createElement('label');
  control.className = 'theater-recommendations-setting';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.role = 'switch';
  const text = document.createElement('span');
  control.append(input, text);
  row.append(control);
  container.append(style, row);
  // Unpinned controls overlay the picture: centre the curtain's content in the part their real box leaves clear,
  // including wrapped toolbars. The pinned bar is already outside the curtain.
  const toolbar = (container.getRootNode() as ParentNode).querySelector('.theater-controls-wrapper');
  if (toolbar) {
    const place = () => {
      if (scope.isDisposed) return;
      container.style.paddingBottom = `${Math.max(0, container.getBoundingClientRect().bottom - toolbar.getBoundingClientRect().top + 12)}px`;
    };
    const observer = new ResizeObserver(place);
    observer.observe(toolbar);
    observer.observe(container);
    scope.add(() => observer.disconnect());
    place();
  }
  let grid: HTMLElement | null = null;
  let previous: string | undefined;
  const update = () => {
    if (scope.isDisposed) return;
    const snapshot = source.read();
    row.hidden = !snapshot;
    text.textContent = recommendationsLabel();
    input.checked = settings.values.youtube.showRecommendations;
    input.disabled = !settings.loaded;
    const key = JSON.stringify(settings.loaded && input.checked ? snapshot : null);
    if (key === previous) return;
    previous = key;
    const focused = grid?.matches(':focus-within');
    grid?.remove();
    grid = settings.loaded && input.checked ? renderEndScreen(source, label, scope) : null;
    if (grid) container.insertBefore(grid, row);
    if (focused) (grid?.querySelector('button') ?? input).focus();
  };
  scope.listen(input, 'click', event => { if (event.detail) input.blur(); });
  scope.listen(input, 'change', () => {
    void settings.set('youtube', 'showRecommendations', input.checked).catch(error => {
      console.error('Error saving recommendations:', error);
    }).finally(() => { update(); });
  });
  scope.add(settings.subscribe(update));
  scope.add(languageRuntime.subscribe(update));
  scope.add(() => { style.remove(); row.remove(); grid?.remove(); });
  update();
  return update;
}
