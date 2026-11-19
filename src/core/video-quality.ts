import type { ChoiceMenu } from '../ui/cc-menu';
import type { createPlayerSettings } from '../ui/player-settings';

import type { DisposableScope } from './disposable-scope';

/** One resolution the host offers for the current media item. */
export interface VideoQualityLevel {
  /** Opaque to the player; the provider resolves it again against the live host list on selection. */
  id: string;
  /** The host's own name, such as `1080p60`. */
  label: string;
  /** Picture height in pixels, for ordering. */
  height: number;
}

/** The levels of one media item, highest first. */
export interface VideoQualityState {
  /** The item the levels describe; a selection names it, so a pick for an earlier item is refused. */
  mediaId: string;
  levels: readonly VideoQualityLevel[];
  /** The level the viewer fixed, or null while the host chooses automatically. */
  fixed: string | null;
  /** The level playing now, when the host says; shown beside Auto. */
  playing: string | null;
}

/**
 * A host's quality choice for one bound player. `read` is cheap, has no side effects and returns null whenever a pick
 * would not reach the content (no levels, an ad, another item, the integration off). `select` revalidates the item and
 * the level against the live host before acting; `null` hands the choice back to the host (Auto).
 */
export interface VideoQualitySource {
  read(): VideoQualityState | null;
  select(id: string | null, mediaId: string): boolean;
  /** Reports level, selection and availability changes (no reads) until the returned cleanup, safe to repeat. */
  subscribe(changed: () => void): () => void;
}

/**
 * What the player lends a provider for the settings menu's Video quality row: its own settings panel and choice list,
 * so the row and its nested list are the same controls as their neighbours. The view that builds them ships with the
 * providers (like the playlist panel), not in every page's shared bundle.
 */
export interface VideoQualityMenuHost {
  /** The controls' scope: the row, its list and every subscription end with it. */
  scope: DisposableScope;
  settings: ReturnType<typeof createPlayerSettings>;
  ChoiceMenu: typeof ChoiceMenu;
  setIcon(element: HTMLElement, svg: string): void;
}

/** The mounted row; the player keeps it only to know the feature is present. */
export interface VideoQualityControl {
  row: HTMLElement;
}
