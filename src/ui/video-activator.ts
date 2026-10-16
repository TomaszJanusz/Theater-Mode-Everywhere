import { DisposableScope } from '../core/disposable-scope';
import { isSwitchableTheaterVideo } from '../switchable-videos';
import { mountPlayerUi, peekPlayerUiRoot } from './root';
import {
  ACTIVATOR_SIZE,
  chooseActivatorSpot,
  isActivatorVideoEligible,
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
 * A small launcher over the hovered video. The only always-on cost is one passive
 * `pointerover` listener: it fires when the pointer crosses into another element, never
 * per pixel. Pointermove, scroll, resize and a ResizeObserver exist only while a video is
 * hovered, and everything is released on leave. The caller owns arming: it disposes this
 * while theater is open, the setting is off or the domain is excluded.
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
  let hoverScope: DisposableScope | null = null;
  let button: HTMLButtonElement | null = null;
  let placement: Placement | null = null;
  let lastSpot: ActivatorSpot | null = null;
  let lastActivity = 0;
  let idleHidden = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingPoint: [number, number] | null = null;
  let pointFrame = 0;
  let layoutFrame = 0;
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
    // The button is itself a hit target, so measure with it out of the way.
    button?.remove();
    const choice = chooseActivatorSpot(box, view, (x, y) => isFree(video, box, x, y),
      { preferred: lastSpot, bottomBlocked: video.controls });
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
    hoverScope?.dispose();
    hoverScope = null;
    hovered = null;
    placement = null;
    pendingPoint = null;
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

  /** The one place that reads the video's rect: on enter, on resize, and coalesced per frame while scrolling. */
  function refreshLayout(): void {
    const video = hovered;
    if (!video) return;
    const rect = video.getBoundingClientRect();
    const view = viewport();
    if (!video.isConnected || rect.bottom <= 0 || rect.right <= 0 || rect.top >= view.height
        || rect.left >= view.width || !eligible(video, rect)) { leave(); return; }
    const box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
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
    armIdle();
  }

  function enter(video: HTMLVideoElement): void {
    if (!eligible(video, video.getBoundingClientRect())) return;
    hovered = video;
    const owned = scope.child();
    hoverScope = owned;
    const schedule = (): void => {
      if (layoutFrame) return;
      layoutFrame = owned.raf(() => { layoutFrame = 0; refreshLayout(); });
    };
    owned.add(() => { layoutFrame = 0; });
    owned.listen(document, 'pointermove', () => {
      lastActivity = performance.now();
      // After an idle hide the next movement brings the button back from the cached spot.
      if (idleHidden) { idleHidden = false; schedule(); }
    }, { passive: true, capture: true });
    owned.listen(window, 'scroll', schedule, { passive: true, capture: true });
    owned.listen(window, 'resize', schedule, { passive: true });
    owned.listen(document.documentElement, 'mouseleave', leave);
    owned.listen(video, 'enterpictureinpicture', leave);
    if (typeof ResizeObserver === 'function') {
      let initial = true; // observe() reports the current size once
      const observer = new ResizeObserver(() => { if (initial) initial = false; else schedule(); });
      observer.observe(video);
      owned.add(() => observer.disconnect());
    }
    lastActivity = performance.now();
    refreshLayout();
  }

  function consider(video: HTMLVideoElement | null): void {
    if (video === hovered) { lastActivity = performance.now(); return; }
    leave();
    if (video) enter(video);
  }

  function resolveAtPoint(): void {
    pointFrame = 0;
    const point = pendingPoint;
    pendingPoint = null;
    if (!point) return;
    // Pages without a light-DOM video need no hit test; the collection is live and cached.
    if (!hovered && document.getElementsByTagName('video').length === 0) return;
    const stack = document.elementsFromPoint(point[0], point[1]);
    if (stack[0]?.id === EXTENSION_UI_HOST_ID) { consider(null); return; }
    const video = stack.find((element): element is HTMLVideoElement => element instanceof HTMLVideoElement) ?? null;
    // A modal over the video owns the pointer.
    const modal = video && stack.slice(0, stack.indexOf(video)).some(element => element.matches(MODAL_SELECTOR));
    consider(modal ? null : video);
  }

  scope.listen(document, 'pointerover', (event: PointerEvent) => {
    if (event.pointerType === 'touch' || document.fullscreenElement) return;
    const path = event.composedPath();
    if (button && path.includes(button)) return;
    const host = document.getElementById(EXTENSION_UI_HOST_ID);
    if (host && path.includes(host)) { consider(null); return; }
    const direct = path.find((node): node is HTMLVideoElement => node instanceof HTMLVideoElement);
    if (direct) { pendingPoint = null; consider(direct); return; }
    pendingPoint = [event.clientX, event.clientY];
    if (!pointFrame) pointFrame = scope.raf(resolveAtPoint);
  }, { passive: true, capture: true });
  scope.listen(document, 'fullscreenchange', leave);
  scope.listen(document, 'visibilitychange', () => { if (document.hidden) leave(); });
  scope.listen(window, 'pagehide', leave);
  scope.listen(window, 'popstate', leave);
  scope.add(leave);
  return { dispose: () => scope.dispose() };
}
