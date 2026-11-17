import type { ButtonTooltipBinder } from '../ui/button-tooltip';
import type { bindMenuPopover } from '../ui/menu-popover';

import type { DisposableScope } from './disposable-scope';

/** One entry of a host playlist, as the player's playlist panel lists it. */
export interface PlaylistPanelItem {
  /** Opaque to the player. The provider resolves it again against the live host list on activation. */
  key: string;
  /** 1-based position in the whole list; null when the host does not number it. */
  position: number | null;
  title: string;
  /** Usually the channel or uploader; empty when unknown. */
  byline: string;
  /** The host's own duration text (`16:09`); empty for live or unknown items. */
  duration: string;
  /** An https thumbnail; empty when none is cheap to show. */
  imageUrl: string;
  current: boolean;
  /** False for items the host lists but cannot play (private, deleted, region-locked). */
  playable: boolean;
}

/** A host playlist bound to the theater's player. `items` may be the window of a longer list the host has loaded. */
export interface PlaylistPanelSnapshot {
  title: string;
  owner: string;
  /** Items in the whole list, when the host knows them; null for endless lists such as mixes. */
  total: number | null;
  items: readonly PlaylistPanelItem[];
}

/**
 * A provider's playlist for one bound player: what the shared panel view reads. `available` gates the toggle and is
 * read on every playlist-navigation refresh, so it must stay a cheap check. Host data is read and observed only between
 * `mount` and the end of its scope.
 */
export interface PlaylistPanelSource {
  available(): boolean;
  /**
   * Fills the panel for one opening. `scope` is that opening: everything added (nodes, observers, listeners) is
   * disposed with it, and work after `scope.isDisposed` is rejected. `close` closes the panel, returning focus to the
   * toggle when asked, as after a keyboard activation.
   */
  mount(panel: HTMLElement, scope: DisposableScope, close: (restoreFocus: boolean) => void): void;
}

/**
 * What the player lends the provider for the bar's playlist toggle. The toggle is built from the bar's own icon,
 * tooltip and menu shell, so it is the same control as its neighbours; the shared view that builds it ships with the
 * providers (like the end-screen view), not in every page's shared bundle.
 */
export interface PlaylistPanelBar {
  /** The controls' scope: the toggle, its panel and any opening end with it. */
  scope: DisposableScope;
  label: string;
  setIcon(element: HTMLElement, svg: string): void;
  bindTooltip: ButtonTooltipBinder;
  bindMenu: typeof bindMenuPopover;
  /** Closes the bar's other menus before this one opens. */
  onBeforeOpen(): void;
  /** The panel opened or closed. */
  onChange(): void;
}

/** The toggle and its panel, which the player places with the step controls and drives. */
export interface PlaylistPanelControl {
  host: HTMLElement;
  /** Shows the toggle only while the provider has a list; a list that went away closes the panel. */
  syncAvailability(): void;
  close(restoreFocus?: boolean): boolean;
}

const MAX_TEXT = 300;
const MAX_ITEMS = 5000;

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '';
}

function httpsImage(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 2000) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function count(value: unknown, min: number): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min ? value : null;
}

/**
 * Validates a snapshot that crossed a world boundary as untrusted data. Invalid items are dropped; a list without a
 * single valid item, or with more than one current item, is no list.
 */
export function parsePlaylistSnapshot(value: unknown): PlaylistPanelSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.items) || data.items.length > MAX_ITEMS) return null;
  const keys = new Set<string>();
  const items: PlaylistPanelItem[] = [];
  for (const raw of data.items as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const key = typeof item.key === 'string' && item.key.length <= 4000 ? item.key : '';
    const title = text(item.title);
    if (!key || !title || keys.has(key)) continue;
    keys.add(key);
    items.push({
      key, title,
      position: count(item.position, 1),
      byline: text(item.byline),
      duration: text(item.duration),
      imageUrl: httpsImage(item.imageUrl),
      current: item.current === true,
      playable: item.playable !== false
    });
  }
  if (!items.length || items.filter(item => item.current).length > 1) return null;
  return { title: text(data.title), owner: text(data.owner), total: count(data.total, 1), items };
}
