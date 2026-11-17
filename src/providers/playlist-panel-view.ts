import type { DisposableScope } from '../core/disposable-scope';
import type {
  PlaylistPanelBar, PlaylistPanelControl, PlaylistPanelItem, PlaylistPanelSnapshot, PlaylistPanelSource
} from '../core/playlist-panel';
import { translateMessage } from '../i18n-runtime';
import { MENU_CLOSE_EVENT, MENU_OPEN_EVENT } from '../ui/menu-popover';

import css from './playlist-panel-view.css?inline';

/** A provider's host list: what the panel view reads, activates and observes for one opening. */
export interface PlaylistData {
  /** The current list, or null when the host has none for this player now. */
  read(): PlaylistPanelSnapshot | null;
  /** Revalidates `key` against the live host list and navigates through the host. False when it went stale. */
  activate(key: string): boolean;
  /** Reports host list changes (no reads) until the returned cleanup, which is safe to repeat. */
  subscribe(changed: () => void): () => void;
}

/** Provider-only fallbacks: these bytes never join content.js. */
const FALLBACKS: Record<string, string> = {
  playlistPanelTitle: 'Playlist',
  playlistPosition: 'Video $1 of $2',
  playlistUnavailable: 'This playlist is not available right now.',
  playlistNowPlaying: 'Now playing'
};
const t = (key: string, substitutions?: string[]) => translateMessage(FALLBACKS, key, substitutions);

const NOW_PLAYING_ICON = 'M7 4.5v15L19.5 12z';

const PLAYLIST_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h13M3 12h9M3 18h7"/><path d="M15 14.5v6l5.5-3z" fill="currentColor"/></svg>';

/**
 * The bar's playlist toggle and its panel: a `.theater-control-btn` in the bar's anchored list-menu shell (the subtitle
 * menu's), bound with the bar's own menu, icon and tooltip helpers, so hover, pinning, Escape, outside presses, focus,
 * `aria-expanded`, the slot geometry and the bar's visibility are the shared control's. Each opening mounts the
 * source's list in a child of the controls' scope that ends when the panel closes: nothing reads or observes the host
 * while it is shut.
 */
export function mountPlaylistPanel(source: PlaylistPanelSource, bar: PlaylistPanelBar): PlaylistPanelControl {
  const { scope } = bar;
  const host = document.createElement('div');
  host.className = 'theater-menu-anchored';
  host.hidden = true;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'theater-control-btn theater-playlist-toggle';
  trigger.setAttribute('aria-label', bar.label);
  bar.setIcon(trigger, PLAYLIST_ICON);
  bar.bindTooltip(trigger, () => bar.label);
  const panel = document.createElement('div');
  panel.className = 'theater-cc-menu theater-playlist-menu';
  host.append(trigger, panel);

  let opening: DisposableScope | null = null;
  const unmount = () => {
    opening?.dispose();
    opening = null;
  };
  const menu = bar.bindMenu({
    host, trigger, panel, scope,
    onBeforeOpen: bar.onBeforeOpen,
    // Keyboard opening lands on the playing item (the list's active row), and the list opens centred on it.
    firstFocus: () => panel.querySelector<HTMLElement>('.active') ?? undefined,
    centerActiveIn: '.theater-cc-menu-list',
    onChange: bar.onChange
  });
  // Dispatched before the menu positions itself, so the rows are in place for focus and centring.
  scope.listen(panel, MENU_OPEN_EVENT, () => {
    unmount();
    opening = scope.child();
    source.mount(panel, opening, menu.close);
  });
  scope.listen(panel, MENU_CLOSE_EVENT, unmount);

  return {
    host,
    close: menu.close,
    syncAvailability() {
      const available = source.available();
      if (!available) menu.close();
      if (host.hidden === available) host.hidden = !available;
    }
  };
}

/**
 * The shared playlist view, the same for every provider: a header and a compact list of rows (position, thumbnail with
 * duration, title, byline) in the player's list-menu shell. Pointer and keyboard activation are one click handler;
 * arrow keys, Home and End move between rows. It reads the host on mount and after each reported change, and repaints
 * only when what it shows changed.
 */
export function mountPlaylistView(
  data: PlaylistData,
  panel: HTMLElement,
  scope: DisposableScope,
  close: (restoreFocus: boolean) => void
): void {
  const style = document.createElement('style');
  style.textContent = css;
  const header = document.createElement('div');
  header.className = 'theater-cc-menu-header';
  const heading = document.createElement('div');
  heading.className = 'theater-playlist-heading';
  const title = document.createElement('span');
  title.className = 'theater-cc-menu-title';
  const meta = document.createElement('span');
  meta.className = 'theater-playlist-meta';
  heading.append(title, meta);
  header.append(heading);
  const list = document.createElement('ul');
  list.className = 'theater-cc-menu-list theater-playlist-list';
  panel.append(style, header, list);
  scope.add(() => { style.remove(); header.remove(); list.remove(); });

  let items: readonly PlaylistPanelItem[] = [];
  let signature: string | null = null;
  const rows = () => [...list.querySelectorAll<HTMLButtonElement>('button.theater-playlist-row')];
  const render = (snapshot: PlaylistPanelSnapshot | null) => {
    if (scope.isDisposed) return;
    const next = JSON.stringify(snapshot);
    if (next === signature) return;
    signature = next;
    items = snapshot?.items ?? [];
    const name = snapshot?.title || t('playlistPanelTitle');
    title.textContent = name;
    title.title = name;
    meta.textContent = metaText(snapshot);
    meta.hidden = !meta.textContent;
    list.setAttribute('aria-label', name);
    // A repaint keeps keyboard focus on the same item (focus that goes nowhere does not close the menu).
    const active = (panel.getRootNode() as Document | ShadowRoot).activeElement;
    const focusedKey = active instanceof HTMLElement && list.contains(active) ? active.dataset.key : undefined;
    list.replaceChildren(...(items.length ? items.map(renderRow) : [renderUnavailable()]));
    if (focusedKey !== undefined) (rows().find(row => row.dataset.key === focusedKey) ?? rows()[0])?.focus({ preventScroll: true });
  };
  // One read for the opening: a notification while subscribing would only repeat it.
  let subscribing = true;
  scope.add(data.subscribe(() => { if (!subscribing) render(data.read()); }));
  subscribing = false;
  render(data.read());

  scope.listen(list, 'click', (event: MouseEvent) => {
    const row = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button.theater-playlist-row') : null;
    const item = row && items.find(entry => entry.key === row.dataset.key);
    if (!item?.playable) return;
    if (item.current || data.activate(item.key)) {
      close(event.detail === 0);
      return;
    }
    // The list changed under the viewer: show the live one rather than navigating somewhere else.
    render(data.read());
  });
  scope.listen(list, 'keydown', (event: KeyboardEvent) => {
    const all = rows();
    const index = all.indexOf(event.target as HTMLButtonElement);
    const target = index < 0 ? -1 : rowKeyTarget(event.key, index, all.length);
    if (target < 0) return;
    event.preventDefault();
    event.stopPropagation();
    all[target].focus({ preventScroll: true });
    all[target].scrollIntoView({ block: 'nearest' });
  });
}

/** The row a key moves focus to, holding at either end; -1 for keys the list leaves alone. */
export function rowKeyTarget(key: string, index: number, count: number): number {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return Math.min(count - 1, index + 1);
  if (key === 'ArrowUp') return Math.max(0, index - 1);
  return -1;
}

/** Owner and, for a list with a known length, where the playing item sits in it. */
export function metaText(snapshot: PlaylistPanelSnapshot | null): string {
  if (!snapshot) return '';
  const current = snapshot.items.find(item => item.current)?.position;
  const position = current && snapshot.total ? t('playlistPosition', [String(current), String(snapshot.total)]) : '';
  // The owner's name keeps its own direction inside a right-to-left line (first-strong isolate).
  return [snapshot.owner && `\u2068${snapshot.owner}\u2069`, position].filter(Boolean).join(' · ');
}

function span(className: string, text: string): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}

function renderRow(item: PlaylistPanelItem): HTMLLIElement {
  const entry = document.createElement('li');
  entry.className = 'theater-playlist-item';
  const row = document.createElement('button');
  row.type = 'button';
  // The subtitle menu's row: shared typography, hover, focus ring and the accent for the active item.
  row.className = 'theater-control-btn theater-settings-row theater-cc-menu-item theater-playlist-row';
  row.dataset.key = item.key;
  row.classList.toggle('active', item.current);
  if (item.current) row.setAttribute('aria-current', 'true');
  if (!item.playable) row.setAttribute('aria-disabled', 'true');

  const index = span('theater-playlist-index', item.current || item.position === null ? '' : String(item.position));
  if (item.current) index.append(nowPlayingIcon());
  const thumb = span('theater-playlist-thumb', '');
  if (item.imageUrl) {
    const image = document.createElement('img');
    image.alt = '';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.src = item.imageUrl;
    thumb.append(image);
  }
  if (item.duration) thumb.append(span('theater-playlist-duration', item.duration));
  const text = span('theater-playlist-text', '');
  text.append(span('theater-playlist-title', item.title));
  if (item.byline) text.append(span('theater-playlist-byline', item.byline));
  // The name is the visible text in reading order (title, byline), then the duration from the thumbnail and the
  // playing state, which only the accent and icon show.
  const spoken = [item.duration, item.current ? t('playlistNowPlaying') : ''].filter(Boolean);
  if (spoken.length) text.append(span('theater-playlist-spoken', `, ${spoken.join(', ')}`));
  index.setAttribute('aria-hidden', 'true');
  thumb.setAttribute('aria-hidden', 'true');
  row.append(index, thumb, text);
  entry.append(row);
  return entry;
}

function nowPlayingIcon(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('fill', 'currentColor');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', NOW_PLAYING_ICON);
  svg.append(path);
  return svg;
}

function renderUnavailable(): HTMLLIElement {
  const entry = document.createElement('li');
  entry.className = 'theater-playlist-item theater-settings-row theater-cc-menu-item';
  entry.setAttribute('aria-disabled', 'true');
  entry.setAttribute('role', 'status');
  entry.textContent = t('playlistUnavailable');
  return entry;
}
