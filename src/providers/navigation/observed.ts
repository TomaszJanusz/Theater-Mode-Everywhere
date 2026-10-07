import type { PlaylistDirection, PlaylistPreview } from '../../playlist-nav';

export type PlaylistProvider = 'youtube' | 'videojs' | 'dailymotion' | 'vimeo-showcase' | 'bilibili' | 'bilibiliIntl' | 'tencent';

/**
 * Host-control snapshot. The fields are the signals observed on live players:
 * YouTube hides an unusable step with inline `display: none` (and aria-disabled
 * on Previous outside a playlist). Video.js uses `vjs-disabled` / `vjs-hidden`
 * while the control bar itself is collapsed. Dailymotion keeps Previous/Next
 * painted but sets `disabled` until the queue can move. Vimeo Showcase draws
 * the steps beside the player, on the left and right edges.
 */
export type ObservedPlaylistControl = {
  provider: PlaylistProvider;
  directionHint: PlaylistDirection | null;
  ariaDisabled: string | null;
  disabled: boolean;
  className: string;
  inlineDisplay: string;
  computedDisplay: string;
  x: number;
  width: number;
};

export type PlaylistNavigationHelpers = {
  sanitizePreview(title: string, imageUrl: string): PlaylistPreview | null;
  neighborPreviews(
    items: Array<{ position: number; title: string; imageUrl: string }>,
    currentPosition: number
  ): { previous: PlaylistPreview | null; next: PlaylistPreview | null };
};

export type PreviewContext = {
  direction: PlaylistDirection;
  page: ParentNode;
  helpers: PlaylistNavigationHelpers;
  neighbors: { previous: PlaylistPreview | null; next: PlaylistPreview | null };
};

export type ControlDescription = {
  preview: PlaylistPreview | null;
  restarts: boolean;
};

export type CollectedControl = {
  element: HTMLElement;
  snapshot: ObservedPlaylistControl;
  describe(context: PreviewContext): ControlDescription;
};

const DIRECTIONS: PlaylistDirection[] = ['previous', 'next'];

export function usableControlIndexes(
  controls: ObservedPlaylistControl[],
  viewportWidth: number
): Array<{ index: number; direction: PlaylistDirection }> {
  const chosen = new Map<PlaylistDirection, number>();

  controls.forEach((control, index) => {
    if (control.provider === 'vimeo-showcase' || !control.directionHint) return;
    if (!isHostStepUsable(control) || chosen.has(control.directionHint)) return;
    chosen.set(control.directionHint, index);
  });

  const vimeo = controls
    .map((control, index) => ({ control, index }))
    .filter((entry) => entry.control.provider === 'vimeo-showcase' && isHostStepUsable(entry.control))
    .sort((a, b) => centerOf(a.control) - centerOf(b.control));

  if (vimeo.length === 1) {
    const direction: PlaylistDirection = centerOf(vimeo[0].control) >= viewportWidth / 2 ? 'next' : 'previous';
    if (!chosen.has(direction)) chosen.set(direction, vimeo[0].index);
  } else if (vimeo.length >= 2) {
    if (!chosen.has('previous')) chosen.set('previous', vimeo[0].index);
    if (!chosen.has('next')) chosen.set('next', vimeo[vimeo.length - 1].index);
  }

  return DIRECTIONS.flatMap((direction) => {
    const index = chosen.get(direction);
    return index === undefined ? [] : [{ index, direction }];
  });
}

export function namedControl(
  root: ParentNode,
  selector: string,
  provider: PlaylistProvider,
  direction: PlaylistDirection,
  describeFor?: (element: HTMLElement) => CollectedControl['describe']
): CollectedControl[] {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) return [];
  return [collectElement(element, provider, direction, describeFor?.(element) ?? inertDescription)];
}

export function collectElement(
  element: HTMLElement,
  provider: PlaylistProvider,
  directionHint: PlaylistDirection | null,
  describe: CollectedControl['describe']
): CollectedControl {
  return {
    element,
    snapshot: snapshotControl(element, provider, directionHint),
    describe
  };
}

function inertDescription(): ControlDescription {
  return { preview: null, restarts: false };
}

function snapshotControl(
  element: HTMLElement,
  provider: PlaylistProvider,
  directionHint: PlaylistDirection | null
): ObservedPlaylistControl {
  const box = element.getBoundingClientRect();
  return {
    provider,
    directionHint,
    ariaDisabled: element.getAttribute('aria-disabled'),
    disabled: element.hasAttribute('disabled'),
    className: typeof element.className === 'string' ? element.className : '',
    inlineDisplay: element.style.display || '',
    computedDisplay: computedDisplay(element),
    x: box.left,
    width: box.width
  };
}

function computedDisplay(element: HTMLElement): string {
  if (typeof getComputedStyle !== 'function') return '';
  try {
    return getComputedStyle(element).display || '';
  } catch {
    return '';
  }
}

function isHostStepUsable(control: ObservedPlaylistControl): boolean {
  if (control.disabled || control.ariaDisabled === 'true') return false;
  const names = new Set(control.className.split(/\s+/).filter(Boolean));
  if (names.has('vjs-disabled') || names.has('vjs-hidden')) return false;
  if (names.has('txp_disabled') || names.has('txp_none') || names.has('disabled') || names.has('bpx-state-disabled')) return false;
  if (control.inlineDisplay === 'none' || control.computedDisplay === 'none') return false;
  if (control.provider === 'vimeo-showcase' && control.width <= 0) return false;
  return true;
}

function centerOf(control: ObservedPlaylistControl): number {
  return control.x + control.width / 2;
}
