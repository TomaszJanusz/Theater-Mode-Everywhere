export type PlaylistDirection = 'previous' | 'next';

export type PlaylistAction = {
  direction: PlaylistDirection;
  activate: () => void;
};

export type PlaylistProvider = 'youtube' | 'videojs' | 'dailymotion' | 'vimeo-showcase';

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

const DIRECTIONS: PlaylistDirection[] = ['previous', 'next'];

export function isVimeoShowcaseStepHref(href: string | null | undefined): boolean {
  if (!href) return false;
  try {
    const url = new URL(href, 'https://vimeo.com');
    return url.origin === 'https://vimeo.com'
      && /^\/showcase\/[^/]+\/?$/.test(url.pathname)
      && url.searchParams.has('video');
  } catch {
    return false;
  }
}

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

export function findPlaylistActions(root: ParentNode, video?: HTMLVideoElement | null): PlaylistAction[] {
  const scope = scopedRoot(root, video);
  const scoped = readControls(scope);
  const controls = scoped.length > 0 || scope === root ? scoped : readControls(root);
  const width = viewportWidth(root);
  return usableControlIndexes(controls.map((entry) => entry.snapshot), width).map(({ index, direction }) => ({
    direction,
    activate: () => {
      controls[index]?.element.click();
    }
  }));
}

function scopedRoot(root: ParentNode, video?: HTMLVideoElement | null): ParentNode {
  const player = video?.closest('#movie_player, .video-js');
  return player ?? root;
}

function viewportWidth(root: ParentNode): number {
  const view = root instanceof Document
    ? root.defaultView
    : root instanceof ShadowRoot
      ? root.host.ownerDocument.defaultView
      : null;
  const width = view?.innerWidth ?? 0;
  return width > 0 ? width : 1280;
}

function readControls(root: ParentNode): Array<{ element: HTMLElement; snapshot: ObservedPlaylistControl }> {
  const controls: Array<{ element: HTMLElement; snapshot: ObservedPlaylistControl }> = [];
  const add = (
    element: Element | null,
    provider: PlaylistProvider,
    directionHint: PlaylistDirection | null
  ) => {
    if (!(element instanceof HTMLElement)) return;
    controls.push({ element, snapshot: snapshotControl(element, provider, directionHint) });
  };

  add(root.querySelector('.ytp-prev-button'), 'youtube', 'previous');
  add(root.querySelector('.ytp-next-button'), 'youtube', 'next');
  add(root.querySelector('button.vjs-previous-video'), 'videojs', 'previous');
  add(root.querySelector('button.vjs-next-video'), 'videojs', 'next');
  add(root.querySelector('[data-testid="button-previous-video"], button.prev_button'), 'dailymotion', 'previous');
  add(root.querySelector('[data-testid="button-next-video"], button.next_button'), 'dailymotion', 'next');

  root.querySelectorAll('button[data-href]').forEach((element) => {
    if (!(element instanceof HTMLElement)) return;
    if (!isVimeoShowcaseStepHref(element.getAttribute('data-href'))) return;
    controls.push({
      element,
      snapshot: snapshotControl(element, 'vimeo-showcase', null)
    });
  });

  return controls;
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
  if (control.inlineDisplay === 'none' || control.computedDisplay === 'none') return false;
  if (control.provider === 'vimeo-showcase' && control.width <= 0) return false;
  return true;
}

function centerOf(control: ObservedPlaylistControl): number {
  return control.x + control.width / 2;
}
