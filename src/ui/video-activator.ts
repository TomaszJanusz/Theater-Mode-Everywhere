import { isMotionReduced } from '../appearance-runtime';
import { DisposableScope } from '../core/disposable-scope';
import { createProviderLauncherPlacement, type LauncherPlacement, type LauncherSlot } from '../providers/launcher-placement';
import { isMiniplayerTarget } from '../providers/playback-session';
import { observeProviderWatchPlaybackChanges } from '../providers/watch-playback';
import { isSwitchableTheaterVideo } from '../switchable-videos';

import { mountPlayerUi, peekPlayerUiRoot } from './root';
import { shortcutDisplayEnv } from './shortcuts';
import {
  ACTIVATOR_PRESS_WINDOW_MS,
  ACTIVATOR_SIZE,
  activatorDistanceSquared,
  activatorPlayGraceRemaining,
  activatorTitle,
  chooseActivatorSpot,
  isActivatorVideoEligible,
  nearestActivatorVideo,
  spotBox,
  type Box
} from './video-activator-placement';

// Pin the overlay for predictable placement; retain dynamic placement intentionally for possible reuse.
let ACTIVATOR_DYNAMIC_PLACEMENT = false;

/** Test seam for exercising the retained dynamic runtime path; call before creating an activator. */
export function setActivatorDynamicPlacementForTests(enabled: boolean): void {
  ACTIVATOR_DYNAMIC_PLACEMENT = enabled;
}

export const VIDEO_ACTIVATOR_CLASS = 'theater-video-activator';
const EXTENSION_UI_HOST_ID = 'theater-everywhere-ui';
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Like the host's own controls, the button gets out of the way once the pointer rests. */
const IDLE_HIDE_MS = 2500;
/** After the viewer presses play the launcher stays this long, so the press is not met by a vanishing button. */
const PLAY_LINGER_MS = 3000;

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

export type VideoActivator = {
  /** Re-reads the tooltip, which carries the user's current theater shortcut. */
  syncTitles(): void;
  dispose(): void;
};

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

const ACCENT = 'var(--accent-color, #6366f1)';
/** Hover/focus inversion timing for both launcher variants; shadow.css reads it as `var(--launcher-fade)`. */
const LAUNCHER_FADE = '0.12s ease';

/** `monochrome` is the provider-toolbar variant: a currentColor body with an accent play triangle. */
function logoMark(monochrome = false): SVGSVGElement {
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
  triangle.setAttribute('class', 'launcher-triangle');
  triangle.setAttribute('d', 'M452.463,207.464L286.575,249.151L411.119,374.731Z');
  triangle.setAttribute('fill', '#ffffff');
  const body = document.createElementNS(SVG_NS, 'path');
  body.setAttribute('d', 'M564,131.691L564,422.309C564,442.559 547.695,459 527.611,459L239.389,459C219.305,459 203,442.559 203,422.309L203,131.691C203,111.441 219.305,95 239.389,95L527.611,95C547.695,95 564,111.441 564,131.691ZM452.463,207.464L286.575,249.151L411.119,374.731L452.463,207.464Z');
  body.setAttribute('class', 'launcher-body');
  body.setAttribute('fill', monochrome ? 'currentColor' : ACCENT);
  body.setAttribute('fill-rule', 'evenodd');
  if (monochrome) triangle.setAttribute('fill', ACCENT);
  group.append(triangle, body);
  svg.append(group);
  return svg;
}

/**
 * Toolbar buttons live in the host page, outside the shadow stylesheet, so the hover/focus inversion
 * is applied directly: the body takes the accent and the triangle empties into a true cut-out.
 * It is instant, so Reduce motion needs no special case; the white-to-accent change keeps its contrast
 * in High contrast, where the resting white mark is already maximal.
 */
function invertMarkOnInteraction(button: HTMLElement, mark: SVGSVGElement): void {
  const body = mark.querySelector<SVGElement>('.launcher-body')!;
  const triangle = mark.querySelector<SVGElement>('.launcher-triangle')!;
  let hovering = false;
  const sync = () => {
    const inverted = hovering || button.matches(':focus-visible');
    body.setAttribute('fill', inverted ? ACCENT : 'currentColor');
    triangle.setAttribute('fill', inverted ? 'none' : ACCENT);
  };
  // Same fade as the overlay, instant under Reduce motion. Applied on change so the first paint never animates.
  const fade = () => { for (const part of [body, triangle]) part.style.transition = isMotionReduced() ? 'none' : 'fill var(--launcher-fade)'; };
  button.addEventListener('pointerenter', () => { hovering = true; fade(); sync(); });
  button.addEventListener('pointerleave', () => { hovering = false; fade(); sync(); });
  button.addEventListener('focus', () => { fade(); sync(); });
  button.addEventListener('blur', () => { fade(); sync(); });
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
  /** The configured theater shortcut; empty while unassigned. */
  shortcut(): string;
}): VideoActivator {
  const scope = new DisposableScope();
  let hovered: HTMLVideoElement | null = null;
  let tracking: DisposableScope | null = null;
  let pointerScope: DisposableScope | null = null;
  const candidates = new Map<HTMLVideoElement, { video: HTMLVideoElement; box: Box }>();
  let pointBlocked = false;
  let onButton = false;
  let geometryDirty = false;
  let button: HTMLButtonElement | null = null;
  const providerPlacements = new Map<HTMLVideoElement, LauncherPlacement>();
  let nativeSlot: LauncherSlot | null = null;
  /** Buttons mounted in persistent provider slots; they follow the native toolbar, not the pointer. */
  const persistentButtons = new Map<HTMLVideoElement, { button: HTMLButtonElement; before: HTMLElement }>();
  /** performance.now() is measured from the page load; an SPA visit restarts the window. */
  let visitStartedAt = 0;
  /** Videos currently playing because the page started them; the viewer's own play still hides the launcher. */
  const selfStarted = new WeakSet<HTMLVideoElement>();
  /** Videos whose current playing run has been classified (and, for the viewer's play, lingered). */
  const runNoted = new WeakSet<HTMLVideoElement>();
  /** The latest press, kept only to tell the viewer's play from the page's. `target` is its innermost node. */
  let lastPress: { at: number; x: number; y: number; target: Node | null; pointer: boolean } | null = null;
  let shownBox: string | null = null;
  let lastActivity = 0;
  let idleHidden = false;
  /** The shown launcher's video that the viewer just started; it hides at `until`, whatever the pointer does. */
  let lingering: { video: HTMLVideoElement; until: number } | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingPoint: [number, number] | null = null;
  let pointFrame = 0;

  scope.add(() => clearTimeout(idleTimer));

  // innerWidth/Height, not documentElement.client*: quirks-mode documents report the content height there.
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

  const playGraceRemaining = () => activatorPlayGraceRemaining(performance.now() - visitStartedAt);

  /** A recent pointer press on the video, or key press inside its container, started this playback. */
  function pressedToPlay(video: HTMLVideoElement): boolean {
    const press = lastPress;
    if (!press || performance.now() - press.at > ACTIVATOR_PRESS_WINDOW_MS) return false;
    if (press.pointer) return activatorDistanceSquared(video.getBoundingClientRect(), press.x, press.y) === 0;
    return Boolean(press.target && video.parentElement?.contains(press.target));
  }

  /**
   * Autoplay can begin long after the load (consent banners, lazy players, ad-to-content swaps), so a
   * start is the page's own unless the viewer pressed the player just before it and the visit is not fresh.
   */
  function classifyPlayback(video: HTMLVideoElement): void {
    if (!video.paused && (playGraceRemaining() > 0 || !pressedToPlay(video))) selfStarted.add(video);
    else selfStarted.delete(video);
  }

  /**
   * `paused` flips inside `play()` but the `play` event is a queued task, so a geometry pass can land in
   * between and would drop the viewer's launcher before it could linger. Whoever sees the run first notes it.
   */
  function noteRun(video: HTMLVideoElement): void {
    if (video.paused) { runNoted.delete(video); return; }
    if (runNoted.has(video)) return;
    runNoted.add(video);
    classifyPlayback(video);
    if (hovered === video && !selfStarted.has(video)) lingerAfterPlay(video);
  }

  /** Whether the video could host a launcher at all, whether or not it is paused. */
  function launchable(video: HTMLVideoElement, box: Box): boolean {
    const root = video.getRootNode();
    return isActivatorVideoEligible({
      width: box.width, height: box.height,
      visible: video.isConnected && (typeof video.checkVisibility !== 'function'
        || video.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })),
      // The provider confirms a parked miniplayer video, which discovery itself never offers.
      playable: isSwitchableTheaterVideo(video) || isMiniplayerTarget(video),
      muted: video.muted, loop: video.loop,
      inExtensionUi: video.hasAttribute('data-theater-everywhere')
        || (root instanceof ShadowRoot && root.host.id === EXTENSION_UI_HOST_ID),
      pictureInPicture: document.pictureInPictureElement === video
    });
  }

  /** Overlay eligibility: paused, or playing on its own (autoplay) rather than because the viewer pressed play. */
  function eligible(video: HTMLVideoElement, box: Box): boolean {
    return (video.paused || selfStarted.has(video) || lingering?.video === video) && launchable(video, box);
  }

  function isFree(video: HTMLVideoElement, box: Box, x: number, y: number): boolean {
    const root = video.getRootNode();
    const stack = (root instanceof ShadowRoot ? root : document).elementsFromPoint(x, y);
    const at = stack.indexOf(video);
    // A video with pointer-events:none is absent from the stack; its shell must be present.
    if (at < 0 && !stack.some(element => element.contains(video))) return false;
    return (at < 0 ? stack : stack.slice(0, at)).every(element => element.contains(video) || !coversPageUi(element, video, box));
  }

  function place(video: HTMLVideoElement, box: Box) {
    if (!ACTIVATOR_DYNAMIC_PLACEMENT) return spotBox(box, 'left-third');
    const view = viewport();
    return chooseActivatorSpot(box, view, (x, y) => isFree(video, box, x, y),
      { bottomBlocked: video.controls })?.box ?? null;
  }

  function hideButton(): void {
    clearTimeout(idleTimer);
    idleTimer = undefined;
    button?.remove();
    shownBox = null;
    nativeSlot = null;
    onButton = false;
  }

  function leave(): void {
    lingering = null;
    hideButton();
    button = null;
    hovered = null;
    idleHidden = false;
  }

  /** Time left before the launcher hides: the play linger when one runs, else the idle window. */
  const hideRemaining = () => lingering ? lingering.until - performance.now()
    : IDLE_HIDE_MS - (performance.now() - lastActivity);

  function armIdle(): void {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      // Pointermove only stamps the time; one timer re-arms for the remainder.
      if (hideRemaining() > 0) { armIdle(); return; }
      if (document.activeElement === button || peekPlayerUiRoot()?.activeElement === button) return; // keyboard focus keeps it
      const ended = lingering;
      if (ended) {
        // The video is playing on the viewer's say-so, so it is no longer a candidate for a launcher.
        lingering = null;
        candidates.delete(ended.video);
        leave();
        return;
      }
      idleHidden = true;
      hideButton();
    }, Math.max(0, hideRemaining()));
  }

  /** The viewer started `video` while its launcher is shown: keep it for a moment, then fade as usual. */
  function lingerAfterPlay(video: HTMLVideoElement): void {
    if (lingering?.video === video) return;
    if (!button?.isConnected) { leave(); return; }
    lingering = { video, until: performance.now() + PLAY_LINGER_MS };
    armIdle();
  }

  const currentTitle = () => activatorTitle(options.label(), options.shortcut(), shortcutDisplayEnv());

  function syncTitles(): void {
    const title = currentTitle();
    for (const element of [button, ...[...persistentButtons.values()].map(entry => entry.button)]) {
      if (element && element.title !== title) element.title = title;
    }
  }

  function createButton(monochrome: boolean): HTMLButtonElement {
    const next = document.createElement('button');
    next.type = 'button';
    next.className = VIDEO_ACTIVATOR_CLASS;
    next.setAttribute('aria-label', options.label());
    next.title = currentTitle();
    const mark = logoMark(monochrome);
    next.append(mark);
    options.paint(next);
    next.style.setProperty('--launcher-fade', LAUNCHER_FADE);
    if (monochrome) invertMarkOnInteraction(next, mark);
    // Pressing must not move focus out of the page's player or reach host handlers.
    next.addEventListener('mousedown', event => event.preventDefault());
    next.addEventListener('pointerdown', event => event.stopPropagation());
    next.addEventListener('keyup', event => event.stopPropagation());
    return next;
  }

  /** Persistent slots: no pointer, idle or playback timing; the provider's toolbar decides visibility. */
  function syncPersistent(videos: Iterable<HTMLVideoElement>): void {
    const live = new Set<HTMLVideoElement>();
    for (const video of videos) {
      const slot = providerPlacements.get(video)?.read();
      if (!slot?.persistent || !video.isConnected || !launchable(video, video.getBoundingClientRect())) continue;
      live.add(video);
      const mounted = persistentButtons.get(video);
      if (mounted?.button.isConnected && mounted.before === slot.before && mounted.button.nextElementSibling === slot.before) continue;
      const focused = mounted && (document.activeElement === mounted.button || peekPlayerUiRoot()?.activeElement === mounted.button);
      mounted?.button.remove();
      const element = createButton(true);
      element.addEventListener('click', event => {
        event.stopPropagation();
        const current = persistentButtons.get(video);
        if (current?.button !== element || !element.isConnected) return;
        // The toolbar may have been rebuilt since the last layout pass.
        const usable = video.isConnected && launchable(video, video.getBoundingClientRect())
          && providerPlacements.get(video)?.read()?.before === current.before;
        if (usable) options.activate(video);
      });
      element.addEventListener('keydown', event => event.stopPropagation());
      persistentButtons.set(video, { button: element, before: slot.before });
      slot.mount(element);
      if (focused) element.focus();
    }
    for (const [video, entry] of persistentButtons) {
      if (live.has(video)) continue;
      entry.button.remove();
      persistentButtons.delete(video);
    }
  }

  function ensureButton(): HTMLButtonElement {
    if (button) return button;
    const next = createButton(Boolean(nativeSlot));
    next.addEventListener('click', event => {
      event.stopPropagation();
      if (button !== next || !next.isConnected) return;
      const video = hovered;
      const usable = video?.isConnected && eligible(video, video.getBoundingClientRect())
        && (!nativeSlot || providerPlacements.get(video)?.read()?.before === nativeSlot.before);
      leave();
      if (video && usable) options.activate(video);
    });
    next.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key !== 'Escape') return;
      // A late geometry refresh must not turn the dismissed point into a new hover.
      pendingPoint = null;
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
    const key = `${box.left},${box.top},${box.width},${box.height}@${view.width},${view.height}`;
    const slot = providerPlacements.get(video)?.read() ?? null;
    if (button?.isConnected && shownBox === key && nativeSlot?.before === slot?.before
        && (!slot || button.nextElementSibling === slot.before)) return;
    const focused = button && (document.activeElement === button || peekPlayerUiRoot()?.activeElement === button);
    hideButton();
    button = null;
    nativeSlot = slot;
    if (slot) {
      const nativeButton = ensureButton();
      slot.mount(nativeButton);
      shownBox = key;
      idleHidden = false;
      if (focused) nativeButton.focus();
      armIdle();
      return;
    }
    const spot = place(video, box);
    if (!spot) { hideButton(); return; }
    const left = spot.left;
    const top = spot.top;
    // Scrolling can carry the cached spot off screen while the video is still visible.
    if (left < 0 || top < 0 || left + ACTIVATOR_SIZE > view.width || top + ACTIVATOR_SIZE > view.height) {
      hideButton();
      return;
    }
    const element = ensureButton();
    element.style.left = `${Math.round(left)}px`;
    element.style.top = `${Math.round(top)}px`;
    if (!element.isConnected) mountPlayerUi(element);
    shownBox = key;
    if (focused) element.focus();
    idleHidden = false;
    armIdle();
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
    owned.add(() => { lastPress = null; });
    for (const type of ['pointerdown', 'keydown'] as const) {
      owned.listen(window, type, (event: Event) => {
        const point = event instanceof PointerEvent ? event : null;
        lastPress = { at: performance.now(), x: point?.clientX ?? 0, y: point?.clientY ?? 0,
          target: (event.composedPath()[0] as Node | undefined) ?? null, pointer: Boolean(point) };
      }, { passive: true, capture: true });
    }
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
        noteRun(video);
        const rect = video.getBoundingClientRect();
        // A persistent slot lives in the native toolbar; the overlay never competes for that video.
        if (providerPlacements.get(video)?.read()?.persistent) continue;
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
      syncPersistent(videos.keys());
      // Only a new appearance or a changed rectangle may choose a new overlay slot.
      if (hovered && !candidates.has(hovered)) leave();
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
        const providerPlacement = createProviderLauncherPlacement(node, schedule);
        if (providerPlacement) {
          providerPlacements.set(node, providerPlacement);
          videoScope.add(() => { providerPlacement.dispose(); providerPlacements.delete(node); });
        }
        noteRun(node);
        for (const event of ['play', 'playing', 'pause', 'loadedmetadata', 'emptied', 'volumechange', 'enterpictureinpicture', 'leavepictureinpicture']) {
          videoScope.listen(node, event, () => {
            noteRun(node);
            if (event === 'pause' && lingering?.video === node) { lingering = null; if (button?.isConnected) armIdle(); }
            schedule();
          });
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
      for (const entry of persistentButtons.values()) entry.button.remove();
      persistentButtons.clear();
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
  const restartVisit = (): void => { visitStartedAt = performance.now(); stopTracking(); startTracking(); };
  scope.listen(window, 'popstate', restartVisit);
  scope.add(observeProviderWatchPlaybackChanges(restartVisit));
  startTracking();
  return { syncTitles, dispose: () => scope.dispose() };
}
