import type { DisposableScope } from '../core/disposable-scope';
import { languageRuntime, translateMessage } from '../i18n-runtime';

import css from './end-screen-view.css?inline';
import type { ProviderSettingsStore } from './settings';

/** Host-owned text and URLs a provider extracted from the links its host rendered. */
export interface EndScreenItem {
  id: string;
  /** The item's absolute page URL on the host page's own origin; it makes the tile a real link. */
  href?: string;
  kind: 'video' | 'playlist';
  title: string;
  thumbnailUrl?: string;
  channel?: string;
  /** The channel's absolute page URL on the host page's own origin; it makes the channel a link of its own. */
  channelHref?: string;
  meta?: string;
  durationText?: string;
}

export interface EndScreenSnapshot {
  mediaId: string;
  items: readonly EndScreenItem[];
}

export interface SuggestionSource {
  read(): EndScreenSnapshot | null;
  activate(id: string, mediaId: string): boolean;
}

/** Provider-only fallback: these bytes never join content.js or mainWorld.js. */
export const recommendationsLabel = () => translateMessage({ providerShowRecommendations: 'Show recommendations' }, 'providerShowRecommendations');

/** Only an http(s) URL on the page's own origin becomes a link: never a script, data or foreign URL. */
function linkHref(href: string | undefined): string | null {
  try {
    const url = new URL(href ?? '');
    return /^https?:$/.test(url.protocol) && url.origin === location.origin ? url.href : null;
  } catch { return null; }
}

/** The recommendation (and, for its channel link, the part) each focusable shows, so a rebuild can keep focus on it. */
const tileIds = new WeakMap<Element, string>();
const FOCUSABLE = '.theater-end-screen-tile, .theater-end-screen-channel[href]';

/** Browser-owned clicks: new tab or window, download. The context menu and middle click never fire `click`. */
const opensElsewhere = (event: MouseEvent) => event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;

/** A line of text, or nothing for an empty value. */
function line(value: string | undefined, className: string, parent: HTMLElement, node: HTMLElement = document.createElement('span')) {
  if (!value) return null;
  node.className = className;
  node.textContent = value;
  parent.append(node);
  return node;
}

/** The tile's picture and title, then screen-reader copies of the card's other lines for its name, title first. */
function fillTile(tile: HTMLElement, item: EndScreenItem): void {
  const picture = document.createElement('span');
  picture.className = 'theater-end-screen-picture';
  picture.setAttribute('aria-hidden', 'true');
  if (item.thumbnailUrl) {
    const image = document.createElement('img');
    image.src = item.thumbnailUrl;
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    picture.append(image);
  }
  line(item.durationText, 'theater-end-screen-duration', picture);
  tile.append(picture);
  line(item.title, 'theater-end-screen-title', tile);
  for (const value of [item.channel, item.meta, item.durationText]) line(value, 'theater-sr-only', tile);
}

/**
 * The card's lines beside the tile, shown to the eye only (the tile's name carries them): the channel, a link of its
 * own when valid, and the meta line. The channel opens in a new tab, as the byline's channels do, so theater keeps
 * the curtain it came from.
 */
function appendCardLines(card: HTMLElement, item: EndScreenItem): void {
  const href = item.channel && linkHref(item.channelHref);
  const link = href ? Object.assign(document.createElement('a'), { href, target: '_blank', rel: 'noopener noreferrer' }) : undefined;
  const channel = line(item.channel, 'theater-end-screen-channel', card, link);
  if (link) tileIds.set(link, `${item.id}\nchannel`);
  else channel?.setAttribute('aria-hidden', 'true');
  line(item.meta, 'theater-end-screen-meta', card)?.setAttribute('aria-hidden', 'true');
}

/**
 * One activation path: a plain click and Enter (Space too on a button tile) run the same host command. A tile with a
 * valid `href` is a real link, so the browser keeps its own new-tab, context-menu and status-bar behaviour.
 *
 * Each card holds the tile and, beside it rather than inside, the channel: a link of its own when the provider gave a
 * valid `channelHref`. The tile stretches over the whole card, and the channel link sits above it, so a click anywhere
 * else still opens the video and no link is nested in another. The tile's name keeps the card's text, read from
 * screen-reader-only copies of the lines the card shows outside it.
 */
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
    const href = linkHref(item.href);
    const card = document.createElement('div');
    card.className = 'theater-end-screen-card';
    // Firefox and Safari on macOS skip plain links on Tab by default; tabIndex keeps the tile one tab stop like a button.
    const tile: HTMLElement = href ? Object.assign(document.createElement('a'), { href, rel: 'noopener noreferrer', tabIndex: 0 })
      : Object.assign(document.createElement('button'), { type: 'button' });
    tile.className = 'theater-end-screen-tile';
    fillTile(tile, item);
    card.append(tile);
    appendCardLines(card, item);
    // Removed nodes can still receive a queued click; the provider checks the visit again too. A link left from an
    // older snapshot opens nothing, here or in a new tab, and drops its href so its context menu offers none.
    const current = (event: MouseEvent) => {
      if (!scope.isDisposed && tile.isConnected && source.read()?.mediaId === snapshot.mediaId) return true;
      tile.removeAttribute('href');
      event.preventDefault();
      return false;
    };
    // Bound to the tile, not the mount scope: a click on a link left behind must never fall through to navigation.
    tile.addEventListener('click', event => {
      const live = current(event);
      if (live && href && opensElsewhere(event)) return;
      event.preventDefault();
      if (event.detail) tile.blur();
      if (live && !source.activate(item.id, snapshot.mediaId)) grid.remove();
    });
    if (href) for (const type of ['auxclick', 'contextmenu'] as const) tile.addEventListener(type, current);
    tileIds.set(tile, item.id);
    grid.append(card);
  }
  return grid;
}

/** The switch outlives its tiles, so a saved off choice is reversible on the same curtain. */
export function mountEndScreenSettings(
  container: HTMLElement, source: SuggestionSource,
  { label, scope, settings, provider }: { label: string; scope: DisposableScope; settings: ProviderSettingsStore; provider: string }
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
    input.checked = settings.values[provider]?.showRecommendations ?? false;
    input.disabled = !settings.loaded;
    const key = JSON.stringify(settings.loaded && input.checked ? snapshot : null);
    if (key === previous) return;
    previous = key;
    // Focus stays on the same recommendation (or its channel) when it remains, else moves to the first tile or the switch.
    const focused = grid?.matches(':focus-within') ? tileIds.get(grid.querySelector(':focus')!) ?? '' : undefined;
    grid?.remove();
    grid = settings.loaded && input.checked ? renderEndScreen(source, label, scope) : null;
    if (grid) container.insertBefore(grid, row);
    const focusables = [...grid?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []];
    if (focused !== undefined) {
      (focusables.find(node => tileIds.get(node) === focused) ?? grid?.querySelector<HTMLElement>('.theater-end-screen-tile') ?? input).focus();
    }
  };
  scope.listen(input, 'click', event => { if (event.detail) input.blur(); });
  scope.listen(input, 'change', () => {
    void settings.set(provider, 'showRecommendations', input.checked).catch(error => {
      console.error('Error saving recommendations:', error);
    }).finally(() => { update(); });
  });
  scope.add(settings.subscribe(update));
  scope.add(languageRuntime.subscribe(update));
  scope.add(() => { style.remove(); row.remove(); grid?.remove(); });
  update();
  return update;
}
