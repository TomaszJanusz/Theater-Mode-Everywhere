export type PlaylistDirection = 'previous' | 'next';

export type PlaylistPreview = {
  title: string;
  imageUrl: string;
};

export type PlaylistNavState = {
  previous: boolean;
  next: boolean;
  /** YouTube's previous control restarts the current video once playback has left the start. */
  previousRestarts: boolean;
  previousPreview: PlaylistPreview | null;
  nextPreview: PlaylistPreview | null;
};

export type PlaylistAction = {
  direction: PlaylistDirection;
  activate: () => void;
  preview: PlaylistPreview | null;
  /** The host previous control will restart the current item instead of stepping back. */
  restarts?: boolean;
};

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

export function emptyPlaylistNav(): PlaylistNavState {
  return { previous: false, next: false, previousRestarts: false, previousPreview: null, nextPreview: null };
}

export function sanitizePlaylistPreview(title: string, imageUrl: string): PlaylistPreview | null {
  const cleanTitle = title.replace(/\s+/g, ' ').trim();
  if (!cleanTitle || cleanTitle.length > 180) return null;
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.href.length > 2000) return null;
  return { title: cleanTitle, imageUrl: url.href };
}

export function neighborPreviews(
  items: Array<{ position: number; title: string; imageUrl: string }>,
  currentPosition: number
): { previous: PlaylistPreview | null; next: PlaylistPreview | null } {
  const byPosition = new Map<number, PlaylistPreview>();
  for (const item of items) {
    if (byPosition.has(item.position)) continue;
    const preview = sanitizePlaylistPreview(item.title, item.imageUrl);
    if (preview) byPosition.set(item.position, preview);
  }
  return {
    previous: byPosition.get(currentPosition - 1) ?? null,
    next: byPosition.get(currentPosition + 1) ?? null
  };
}

export function peerTubeNeighborPreviews(
  root: ParentNode,
  pageHref: string
): { previous: PlaylistPreview | null; next: PlaylistPreview | null } {
  const current = playlistPosition(pageHref);
  if (current == null) return { previous: null, next: null };
  const items: Array<{ position: number; title: string; imageUrl: string }> = [];
  root.querySelectorAll('a.video-info-name').forEach((node) => {
    if (!(node instanceof HTMLAnchorElement)) return;
    const position = playlistPosition(node.getAttribute('href'));
    if (position == null) return;
    const imageUrl = thumbnailNear(node);
    if (!imageUrl) return;
    items.push({
      position,
      title: node.getAttribute('title') || node.textContent || '',
      imageUrl
    });
  });
  return neighborPreviews(items, current);
}

export function vimeoShowcasePreview(root: ParentNode, stepHref: string | null): PlaylistPreview | null {
  const videoId = showcaseVideoId(stepHref);
  if (!videoId) return null;
  for (const node of root.querySelectorAll('a[href*="video="]')) {
    if (!(node instanceof HTMLAnchorElement)) continue;
    if (showcaseVideoId(node.getAttribute('href')) !== videoId) continue;
    const image = [...node.querySelectorAll('img')].find((item) => {
      return /\/video\//.test(item.currentSrc || item.getAttribute('src') || '');
    });
    if (!image) continue;
    const preview = sanitizePlaylistPreview(
      node.querySelector('p')?.textContent || '',
      image.currentSrc || image.getAttribute('src') || ''
    );
    if (preview) return preview;
  }
  return null;
}

export function playlistNavStateFromActions(actions: PlaylistAction[]): PlaylistNavState {
  const previous = actions.find((action) => action.direction === 'previous');
  const next = actions.find((action) => action.direction === 'next');
  return {
    previous: Boolean(previous),
    next: Boolean(next),
    previousRestarts: Boolean(previous?.restarts),
    previousPreview: previous?.restarts ? null : (previous?.preview ?? null),
    nextPreview: next?.preview ?? null
  };
}

/** YouTube drops the previous-item preview when that button will restart the current video. */
export function youtubePreviousRestarts(element: { getAttribute(name: string): string | null }): boolean {
  const image = element.getAttribute('data-preview')?.trim() || '';
  const title = element.getAttribute('data-tooltip-text')?.trim() || '';
  return !image || !title;
}

export function findPlaylistActions(root: ParentNode, video?: HTMLVideoElement | null): PlaylistAction[] {
  const scope = scopedRoot(root, video);
  const scoped = readControls(scope);
  const controls = scoped.length > 0 || scope === root ? scoped : readControls(root);
  const page = previewRoot(root);
  const videoJsNeighbors = peerTubeNeighborPreviews(page, pageHref(page));
  const width = viewportWidth(root);
  return usableControlIndexes(controls.map((entry) => entry.snapshot), width).map(({ index, direction }) => {
    const entry = controls[index];
    const preview = entry ? stepPreview(entry.element, entry.snapshot.provider, direction, page, videoJsNeighbors) : null;
    const restarts = Boolean(
      entry
      && direction === 'previous'
      && entry.snapshot.provider === 'youtube'
      && youtubePreviousRestarts(entry.element)
    );
    return {
      direction,
      preview: restarts ? null : preview,
      restarts,
      activate: () => {
        entry?.element.click();
      }
    };
  });
}

function scopedRoot(root: ParentNode, video?: HTMLVideoElement | null): ParentNode {
  const player = video?.closest('#movie_player, .video-js, .bpx-player-container, .bilibili-player, #bilibiliPlayer, .bstar-player, .txp_player, #internal-player-wrapper');
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
  add(root.querySelector('.bpx-player-ctrl-prev'), 'bilibili', 'previous');
  add(root.querySelector('.bpx-player-ctrl-next'), 'bilibili', 'next');
  add(root.querySelector('.player-mobile-control-btn-next-episode .ip-next-episode'), 'bilibiliIntl', 'next');
  add(root.querySelector('.txp_btn_next_u:not(.txp_none), .txp_btn_next:not(.txp_none), [data-role="wetv-player-ctrl-next"]'), 'tencent', 'next');

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
  if (names.has('txp_disabled') || names.has('txp_none') || names.has('disabled') || names.has('bpx-state-disabled')) return false;
  if (control.inlineDisplay === 'none' || control.computedDisplay === 'none') return false;
  if (control.provider === 'vimeo-showcase' && control.width <= 0) return false;
  return true;
}

function centerOf(control: ObservedPlaylistControl): number {
  return control.x + control.width / 2;
}

function previewRoot(root: ParentNode): ParentNode {
  if (root instanceof ShadowRoot) return root.host.ownerDocument;
  return root;
}

function pageHref(root: ParentNode): string {
  const view = root instanceof Document
    ? root.defaultView
    : root instanceof ShadowRoot
      ? root.host.ownerDocument.defaultView
      : null;
  return view?.location.href || '';
}

function stepPreview(
  element: HTMLElement,
  provider: PlaylistProvider,
  direction: PlaylistDirection,
  page: ParentNode,
  videoJsNeighbors: { previous: PlaylistPreview | null; next: PlaylistPreview | null }
): PlaylistPreview | null {
  if (provider === 'youtube') {
    return sanitizePlaylistPreview(
      element.getAttribute('data-tooltip-text') || '',
      element.getAttribute('data-preview') || ''
    );
  }
  if (provider === 'videojs') return videoJsNeighbors[direction];
  if (provider === 'vimeo-showcase') return vimeoShowcasePreview(page, element.getAttribute('data-href'));
  return null;
}

function playlistPosition(href: string | null | undefined): number | null {
  if (!href) return null;
  try {
    const value = Number(new URL(href, 'https://playlist.local').searchParams.get('playlistPosition'));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function showcaseVideoId(href: string | null | undefined): string | null {
  if (!href || !isVimeoShowcaseStepHref(href)) return null;
  try {
    return new URL(href, 'https://vimeo.com').searchParams.get('video');
  } catch {
    return null;
  }
}

function thumbnailNear(anchor: HTMLElement): string | null {
  let node: HTMLElement | null = anchor;
  for (let depth = 0; depth < 6 && node; depth += 1) {
    node = node.parentElement;
    if (!node) return null;
    if (node.querySelectorAll('a.video-info-name').length !== 1) continue;
    const image = [...node.querySelectorAll('img')].find((item) => (item.currentSrc || item.getAttribute('src') || '').trim());
    if (!image) continue;
    return image.currentSrc || image.getAttribute('src') || null;
  }
  return null;
}
