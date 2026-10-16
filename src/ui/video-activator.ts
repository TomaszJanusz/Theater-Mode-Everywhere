import { DisposableScope } from '../core/disposable-scope';
import { isSwitchableTheaterVideo } from '../switchable-videos';
import { mountPlayerUi, peekPlayerUiRoot } from './root';
import {
  ACTIVATOR_SIZE,
  chooseActivatorSpot,
  isActivatorVideoEligible,
  nearestActivatorVideo,
  type ActivatorSpot,
  type Box
} from './video-activator-placement';

export const VIDEO_ACTIVATOR_CLASS = 'theater-video-activator';
const EXTENSION_UI_HOST_ID = 'theater-everywhere-ui';
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Like the host's own controls, the button gets out of the way once the pointer rests. */
const IDLE_HIDE_MS = 2500;

/** Page UI the activator must not cover: anything a viewer could press, read or type into. */
const INTERACTIVE_SELECTOR = [
  'a[href]', 'button', 'input', 'select', 'textarea', 'summary', 'label', '[contenteditable]',
  '[role="button"]', '[role="link"]', '[role="slider"]', '[role="menu"]', '[role="menuitem"]', '[role="tab"]',
  '[role="switch"]', '[role="checkbox"]', '[role="toolbar"]', '[role="dialog"]', '[tabindex]:not([tabindex="-1"])'
].join(',');
const CONTENT_SELECTOR = 'img, svg, canvas, picture, iframe, video, object, embed';
/** A container this much of the video is a click-catcher or player shell, not a control bar. */
const SHELL_COVERAGE = 0.9;
const MODAL_SELECTOR = '[aria-modal="true"], dialog[open]';

export type VideoActivator = { dispose(): void };

function hasOwnText(element: Element): boolean {
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return true;
  }
  return false;
}

/**
 * Whether `element`, painted above the video, is page UI. Climbs only to the video's
 * container: the player shell is usually focusable and must not disqualify the video itself.
 */
function coversPageUi(element: Element, video: HTMLVideoElement, videoBox: Box): boolean {
  if (element.id === EXTENSION_UI_HOST_ID) return true;
  for (let node: Element | null = element; node && !node.contains(video); node = node.parentElement) {
    if (node.matches(INTERACTIVE_SELECTOR)) return true;
  }
  if (element.matches(CONTENT_SELECTOR) || element.closest('svg') || hasOwnText(element)) return true;
  // A bar of controls is a plain element whose children are the buttons; a shell spanning the video is not.
  if (element.querySelector(INTERACTIVE_SELECTOR)) {
    const box = element.getBoundingClientRect();
    return box.width < videoBox.width * SHELL_COVERAGE || box.height < videoBox.height * SHELL_COVERAGE;
  }
  return false;
}

function logoMark(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 1000 1000');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  // Same mark as the Settings header: the accent body with the white play triangle showing through it.
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('transform', 'matrix(1.457306,1.457306,-1.445295,1.445295,341.469936,-459.223594)');
  const triangle = document.createElementNS(SVG_NS, 'path');
  triangle.setAttribute('d', 'M452.463,207.464L286.575,249.151L411.119,374.731Z');
  triangle.setAttribute('fill', '#ffffff');
  const body = document.createElementNS(SVG_NS, 'path');
  body.setAttribute('d', 'M564,131.691L564,422.309C564,442.559 547.695,459 527.611,459L239.389,459C219.305,459 203,442.559 203,422.309L203,131.691C203,111.441 219.305,95 239.389,95L527.611,95C547.695,95 564,111.441 564,131.691ZM452.463,207.464L286.575,249.151L411.119,374.731L452.463,207.464Z');
  body.setAttribute('fill', 'var(--accent-color, #6366f1)');
  body.setAttribute('fill-rule', 'evenodd');
  group.append(triangle, body);
  svg.append(group);
  return svg;
}

/**
 * The caller owns the setting/theater/domain gates. Discovery and geometry are event-driven;
 * pointer movement only selects among cached eligible rectangles, once per animation frame.
 */
export function createVideoActivator(options: {
  /** Opens theater for this video through the regular toggle path. */
  activate(video: HTMLVideoElement): void;
  /** Applies accent and direction, like every other player overlay. */
  paint(element: HTMLElement): void;
  label(): string;
}): VideoActivator {
  const scope = new DisposableScope();
  /** Where the button sits relative to the video; valid while the video keeps its size and the viewport its shape. */
  type Placement = { key: string; spot: { dx: number; dy: number; name: ActivatorSpot } | null };
  let hovered: HTMLVideoElement | null = null;
  let tracking: DisposableScope | null = null;
  let pointerScope: DisposableScope | null = null;
  const candidates = new Map<HTMLVideoElement, { video: HTMLVideoElement; box: Box }>();
  let pointBlocked = false;
  let onButton = false;
  let geometryDirty = false;
  let button: HTMLButtonElement | null = null;
  let placement: Placement | null = null;
  let lastSpot: ActivatorSpot | null = null;
  let lastActivity = 0;
  let idleHidden = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingPoint: [number, number] | null = null;
  let pointFrame = 0;

  scope.add(() => clearTimeout(idleTimer));

  // innerWidth/Height, not documentElement.client*: quirks-mode documents report the content height there.
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

  function eligible(video: HTMLVideoElement, box: Box): boolean {
    const root = video.getRootNode();
    return isActivatorVideoEligible({
      width: box.width, height: box.height,
      visible: video.isConnected && (typeof video.checkVisibility !== 'function'
        || video.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })),
      playable: isSwitchableTheaterVideo(video),
      muted: video.muted, loop: video.loop,
      inExtensionUi: video.hasAttribute('data-theater-everywhere')
        || (root instanceof ShadowRoot && root.host.id === EXTENSION_UI_HOST_ID),
      pictureInPicture: document.pictureInPictureElement === video
    });
  }

  function isFree(video: HTMLVideoElement, box: Box, x: number, y: number): boolean {
    const root = video.getRootNode();
    const stack = (root instanceof ShadowRoot ? root : document).elementsFromPoint(x, y);
    const at = stack.indexOf(video);
    // A video with pointer-events:none is absent from the stack; its shell must be present.
    if (at < 0 && !stack.some(element => element.contains(video))) return false;
    return (at < 0 ? stack : stack.slice(0, at)).every(element => element.contains(video) || !coversPageUi(element, video, box));
  }

  function place(video: HTMLVideoElement, box: Box): Placement {
    const view = viewport();
    const key = `${Math.round(box.width)}x${Math.round(box.height)}@${view.width}x${view.height}`;
    if (placement?.key === key) return placement;
    // Ignore our own hit target without detaching it and losing keyboard focus.
    const pointerEvents = button?.style.pointerEvents ?? '';
    if (button) button.style.pointerEvents = 'none';
    let choice: ReturnType<typeof chooseActivatorSpot>;
    try {
      choice = chooseActivatorSpot(box, view, (x, y) => isFree(video, box, x, y),
        { preferred: lastSpot, bottomBlocked: video.controls });
    } finally {
      if (button) button.style.pointerEvents = pointerEvents;
    }
    if (choice) lastSpot = choice.spot;
    return { key, spot: choice && { name: choice.spot, dx: choice.box.left - box.left, dy: choice.box.top - box.top } };
  }

  function hideButton(): void {
    clearTimeout(idleTimer);
    idleTimer = undefined;
    button?.remove();
  }

  function leave(): void {
    hideButton();
    button = null;
    hovered = null;
    placement = null;
    idleHidden = false;
  }

  function armIdle(ms = IDLE_HIDE_MS): void {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      // Pointermove only stamps the time; one timer re-arms for the remainder.
      const rest = IDLE_HIDE_MS - (performance.now() - lastActivity);
      if (rest > 0) { armIdle(rest); return; }
      if (peekPlayerUiRoot()?.activeElement === button) return; // keyboard focus keeps it
      idleHidden = true;
      button?.remove();
    }, ms);
  }

  function ensureButton(): HTMLButtonElement {
    if (button) return button;
    const next = document.createElement('button');
    next.type = 'button';
    next.className = VIDEO_ACTIVATOR_CLASS;
    next.setAttribute('aria-label', options.label());
    next.title = options.label();
    next.append(logoMark());
    options.paint(next);
    // Pressing must not move focus out of the page's player or reach host handlers.
    next.addEventListener('mousedown', event => event.preventDefault());
    next.addEventListener('pointerdown', event => event.stopPropagation());
    next.addEventListener('click', event => {
      event.stopPropagation();
      const video = hovered;
      const usable = video?.isConnected && eligible(video, video.getBoundingClientRect());
      leave();
      if (video && usable) options.activate(video);
    });
    next.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      leave();
      next.blur();
    });
    button = next;
    return next;
  }

  function refreshLayout(): void {
    const video = hovered;
    const box = video && candidates.get(video)?.box;
    if (!video || !box) { leave(); return; }
    const view = viewport();
    placement = place(video, box);
    const spot = placement.spot;
    if (!spot) { hideButton(); return; }
    const left = box.left + spot.dx;
    const top = box.top + spot.dy;
    // Scrolling can carry the cached spot off screen while the video is still visible.
    if (left < 0 || top < 0 || left + ACTIVATOR_SIZE > view.width || top + ACTIVATOR_SIZE > view.height) {
      hideButton();
      return;
    }
    const element = ensureButton();
    element.style.left = `${Math.round(left)}px`;
    element.style.top = `${Math.round(top)}px`;
    if (!element.isConnected) mountPlayerUi(element);
    idleHidden = false;
    armIdle(Math.max(0, IDLE_HIDE_MS - (performance.now() - lastActivity)));
  }

  function consider(video: HTMLVideoElement | null, activity = false): void {
    if (activity) lastActivity = performance.now();
    if (video === hovered) {
      if (video && idleHidden && activity) refreshLayout();
      return;
    }
    leave();
    if (!video) return;
    hovered = video;
    lastActivity = performance.now();
    refreshLayout();
  }

  function resolveAtPoint(activity = false): void {
    if (geometryDirty) return; // The invalidation frame, never pointer movement, owns layout reads.
    if (onButton) { if (activity) lastActivity = performance.now(); return; }
    const point = pendingPoint;
    const nearest = point && !pointBlocked ? nearestActivatorVideo(candidates.values(), ...point) : null;
    consider(nearest?.video ?? null, activity);
  }

  function syncPointer(): void {
    if (!candidates.size) {
      pointerScope?.dispose();
      pointerScope = null;
      pendingPoint = null;
      leave();
      return;
    }
    if (pointerScope || !tracking) return;
    const owned = tracking.child();
    pointerScope = owned;
    owned.add(() => { pointFrame = 0; pointerScope = null; });
    owned.listen(document, 'pointerover', (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const path = event.composedPath();
      onButton = Boolean(button && path.includes(button));
      pointBlocked = !onButton && path.some(node => node instanceof Element
        && (node.id === EXTENSION_UI_HOST_ID || node.matches(MODAL_SELECTOR)));
    }, { passive: true, capture: true });
    owned.listen(document, 'pointermove', (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      pendingPoint = [event.clientX, event.clientY];
      if (!pointFrame) pointFrame = owned.raf(() => { pointFrame = 0; resolveAtPoint(true); });
    }, { passive: true, capture: true });
    owned.listen(document.documentElement, 'mouseleave', () => {
      pendingPoint = null;
      onButton = false;
      consider(null);
    });
  }

  /** Discovery is incremental; no DOM query or layout read is performed by pointer handlers. */
  function startTracking(): void {
    if (tracking || scope.isDisposed || document.hidden || document.fullscreenElement) return;
    const owned = scope.child();
    tracking = owned;
    const videos = new Map<HTMLVideoElement, DisposableScope>();
    const roots = new Set<Document | ShadowRoot>();
    let frame = 0;
    let geometryScope: DisposableScope | null = null;
    const schedule = (): void => {
      geometryDirty = true;
      if (!frame) frame = owned.raf(() => { frame = 0; measure(); });
    };
    const resize = new ResizeObserver(schedule);
    const intersection = new IntersectionObserver(schedule);
    owned.add(() => resize.disconnect());
    owned.add(() => intersection.disconnect());

    function measure(): void {
      geometryDirty = false;
      candidates.clear();
      const view = viewport();
      if ([...roots].some(root => root instanceof ShadowRoot && !root.host.isConnected)) {
        const connected = [...roots].filter(root => !(root instanceof ShadowRoot) || root.host.isConnected);
        mutations.disconnect();
        roots.clear();
        for (const root of connected) observeRoot(root);
      }
      for (const [video, videoScope] of videos) {
        if (!video.isConnected) {
          videoScope.dispose();
          videos.delete(video);
          continue;
        }
        const rect = video.getBoundingClientRect();
        if (rect.bottom > 0 && rect.right > 0 && rect.top < view.height && rect.left < view.width
            && eligible(video, rect)) candidates.set(video, { video, box: rect });
      }
      if (!candidates.size) {
        geometryScope?.dispose();
        geometryScope = null;
      } else if (!geometryScope) {
        geometryScope = owned.child();
        geometryScope.listen(window, 'scroll', schedule, { passive: true, capture: true });
        geometryScope.listen(window, 'resize', schedule, { passive: true });
      }
      // Page chrome may have changed without changing the video's size.
      placement = null;
      syncPointer();
      const previous = hovered;
      resolveAtPoint();
      if (hovered && hovered === previous && !idleHidden) refreshLayout();
    }

    function discover(node: Node): void {
      if (!(node instanceof Element || node instanceof Document || node instanceof ShadowRoot)) return;
      if (node instanceof Element && node.id === EXTENSION_UI_HOST_ID) return;
      if (node instanceof HTMLVideoElement && !videos.has(node)) {
        const videoScope = owned.child();
        videos.set(node, videoScope);
        resize.observe(node);
        intersection.observe(node);
        videoScope.add(() => { resize.unobserve(node); intersection.unobserve(node); });
        for (const event of ['loadedmetadata', 'emptied', 'volumechange', 'enterpictureinpicture', 'leavepictureinpicture']) {
          videoScope.listen(node, event, schedule);
        }
      }
      if (node instanceof Document || node instanceof ShadowRoot) observeRoot(node);
      if (node instanceof Element && node.shadowRoot) discover(node.shadowRoot);
      for (const child of node.children) discover(child);
    }

    const mutations = new MutationObserver(records => {
      let changed = false;
      for (const record of records) {
        if (record.target instanceof Element && record.target.closest('#' + EXTENSION_UI_HOST_ID)) continue;
        if (record.type === 'attributes') { changed = true; continue; }
        for (const node of record.addedNodes) {
          if (node instanceof Element && node.id === EXTENSION_UI_HOST_ID) continue;
          discover(node);
          changed = true;
        }
        if (record.removedNodes.length) changed = true;
      }
      if (changed && videos.size) schedule();
    });
    function observeRoot(root: Document | ShadowRoot): void {
      if (roots.has(root)) return;
      roots.add(root);
      mutations.observe(root, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'src', 'muted', 'loop', 'controls'] });
    }
    owned.add(() => mutations.disconnect());
    owned.add(() => {
      tracking = null;
      candidates.clear();
      pendingPoint = null;
      pointBlocked = false;
      onButton = false;
      geometryDirty = false;
      leave();
    });
    discover(document);
    measure();
  }

  function stopTracking(): void { tracking?.dispose(); }
  function syncTracking(): void {
    if (document.hidden || document.fullscreenElement) stopTracking();
    else startTracking();
  }
  scope.listen(document, 'fullscreenchange', syncTracking);
  scope.listen(document, 'visibilitychange', syncTracking);
  scope.listen(window, 'pagehide', stopTracking);
  scope.listen(window, 'pageshow', syncTracking);
  // Drop the old visit's point and cached work before discovering the new visit.
  scope.listen(window, 'popstate', () => { stopTracking(); startTracking(); });
  startTracking();
  return { dispose: () => scope.dispose() };
}
