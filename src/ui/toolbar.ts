import { setSvgIcon } from './svg-icon';
import {
  CAPTION_DOCK_RAISED_CENTER_GAP,
  CAPTION_DOCK_RAISED_EDGE,
  CAPTION_DOCK_REST_BOTTOM,
  CAPTION_LINE_LIMIT_MIN,
  OVERLAY_CAPTIONS_CLASS,
  captionDockMotion,
  computeCaptionDockBottom,
  raisedCaptionLineLimit,
  raisedCaptionRestBottom,
  raisedCaptionRowCount,
  type DockRect
} from '../media-features/caption-dock';
import { isMotionReduced } from '../appearance-runtime';
import { measureNextFrame } from '../core/frame-batch';
import { horizontalLetterboxPx } from './appearance';
import { HEADER_HUD_CLASS } from './hud';
import { resolveChromeVisibility } from './controls-visibility';
import { renderKbdText } from './kbd-text';
import { closeMenuPopover, OPEN_SLIDER_PANEL } from './menu-popover';
import { consumePictureDismiss } from './picture-dismiss';
import { createPictureClickGate, type PictureClickGate } from './picture-click';
import { closePlayerSettings } from './player-settings';
import type { ExtendedHTMLDivElement } from './controls';
import type { PlayerChromeContext } from './runtime-context';
import type { HostCaptionLayout } from '../media-features/types';

export const TOOLBAR_AUTO_HIDE_DELAY_MS = 2500;
export const FULLSCREEN_ACTIVITY_SUPPRESSION_MS = 500;
export const CURSOR_HIDDEN_CLASS = 'theater-everywhere-cursor-hidden';

type DockMotionState = { mode: ReturnType<typeof captionDockMotion>; transition: string };

function applyCaptionDockMotion(
  el: HTMLElement | null,
  motion: ReturnType<typeof captionDockMotion>,
  modes: WeakMap<HTMLElement, DockMotionState>,
  glideWhenLifted = false
): void {
  if (!el) return;
  // A host renderer can rewrite its inline styles during cue replacement.
  const held = modes.get(el);
  if (held?.mode === motion && el.style.getPropertyValue('transition') === held.transition
    && el.style.getPropertyPriority('transition') === 'important') return;
  if (motion === 'moving' || (motion === 'lifted' && glideWhenLifted)) {
    el.style.setProperty(
      'transition',
      'bottom 0.32s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.15s ease',
      'important'
    );
  } else if (motion === 'lifted') el.style.setProperty('transition', 'none', 'important');
  else el.style.setProperty('transition', 'opacity 0.15s ease', 'important');
  void el.offsetWidth;
  modes.set(el, { mode: motion, transition: el.style.getPropertyValue('transition') });
}

export function createToolbar(ctx: PlayerChromeContext, pictureGeometryChanged: () => void = () => {}) {
  function scheduleToolbarHide(): void {
    if (ctx.refs.toolbarTimer) clearTimeout(ctx.refs.toolbarTimer);

    ctx.refs.toolbarTimer = setTimeout(() => {
      ctx.refs.toolbarTimer = null;
      hideToolbar();
    }, TOOLBAR_AUTO_HIDE_DELAY_MS);
  }

  function closeTheaterPopovers(): void {
    const controls = ctx.queryPlayerUi('.theater-controls-wrapper');
    if (controls) closePlayerSettings(controls);
    const ccMenu = ctx.queryPlayerUi<HTMLElement>('.theater-cc-menu');
    if (!closeMenuPopover(ccMenu?.parentElement ?? null)) ccMenu?.classList.remove('visible');
    for (const el of ctx.queryPlayerUiAll<HTMLElement>(
      '.theater-volume-container button, .theater-volume-container input, .theater-speed-container button, .theater-speed-container input'
    )) {
      el.blur();
    }
  }

  function blurMouseToggle(event: MouseEvent, button: HTMLElement): void {
    if (event.detail >= 1) button.blur();
  }

  const obstacleSelector = [
    '.theater-service-action-host',
    '.theater-scrubber-tooltip.visible',
    '.theater-cc-menu.visible',
    '.theater-menu.is-open > .theater-cc-menu',
    '.theater-settings-menu.visible',
    '.theater-menu.is-open > .theater-settings-menu',
    '.theater-button-tooltip.visible',
    OPEN_SLIDER_PANEL
  ].join(',');
  const candidateSelector = '.theater-service-action-host, .theater-scrubber-tooltip, .theater-cc-menu, '
    + '.theater-settings-menu, .theater-button-tooltip, .theater-volume-panel, .theater-speed-panel';
  let cancelDockFrame: (() => void) | null = null;
  let measuringCaptionDock = false;
  let controlsCache: (HTMLElement & {
    _mediaFeatures?: {
      setCaptionLineLimit(maxLines: number): boolean;
      readHostCaptionLayout(): HostCaptionLayout | null;
    };
  }) | null = null;
  let dockOverlayCache: HTMLElement | null = null;
  let overlayTextCache: HTMLElement | null = null;
  let candidates: Element[] = [];
  let candidatesDirty = true;
  let dockObserver: MutationObserver | null = null;
  let dockResizeObserver: ResizeObserver | null = null;
  let dockNativeObserver: MutationObserver | null = null;
  let nativeMotionTarget: HTMLElement | null = null;
  let pictureState = '';

  function resetCaptionDock(): void {
    cancelDockFrame?.();
    cancelDockFrame = null;
    dockObserver?.disconnect();
    dockResizeObserver?.disconnect();
    dockObserver = null;
    dockResizeObserver = null;
    dockNativeObserver?.disconnect();
    dockNativeObserver = null;
    nativeMotionTarget = null;
    controlsCache = null;
    dockOverlayCache = null;
    overlayTextCache = null;
    candidates = [];
    candidatesDirty = true;
    captionDockLifted = false;
    document.documentElement.style.removeProperty('--theater-controls-reserved-height');
  }

  function refreshDockElements(): void {
    if (!controlsCache?.isConnected) {
      dockObserver?.disconnect();
      dockResizeObserver?.disconnect();
      controlsCache = ctx.queryPlayerUi('.theater-controls-wrapper');
      if (!controlsCache) return;
      candidatesDirty = true;
      const root = controlsCache.getRootNode();
      pictureState = pictureKey();
      dockObserver = new MutationObserver(records => {
        let relevant = false;
        for (const record of records) {
          const element = record.target instanceof Element ? record.target : record.target.parentElement;
          if (element === document.documentElement && record.attributeName === 'class') {
            const next = pictureKey();
            if (next !== pictureState) { pictureState = next; relevant = true; }
          }
          // Word colour, clock glyphs and scrubber fill never change dock geometry.
          if (record.type === 'attributes' && element?.closest('.theater-time-slot, .theater-caption-word, .theater-scrubber-track, .theater-service-action-progress')) continue;
          if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node =>
            node instanceof Element && (node.matches(candidateSelector + ', .theater-caption-overlay')
              || node.querySelector(candidateSelector + ', .theater-caption-overlay')))) {
            candidatesDirty = true;
            relevant = true;
          }
          if (element?.matches('.theater-menu, .theater-volume-container, .theater-speed-container')) relevant = true;
          if (element === controlsCache || element?.closest(candidateSelector + ', .theater-caption-overlay')
            || element === dockOverlayCache || element === overlayTextCache) relevant = true;
        }
        if (relevant) updateCaptionDock();
      });
      dockObserver.observe(root, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['class', 'style']
      });
      if (root !== document) dockObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      dockResizeObserver = typeof ResizeObserver === 'undefined'
        ? null : new ResizeObserver(() => updateCaptionDock());
    }
    if (!candidatesDirty) return;
    candidatesDirty = false;
    dockOverlayCache = ctx.queryPlayerUi('.theater-caption-overlay');
    overlayTextCache = dockOverlayCache?.querySelector('.theater-caption-overlay-text') ?? null;
    candidates = ctx.queryPlayerUiAll(candidateSelector);
    dockResizeObserver?.disconnect();
    for (const element of [controlsCache, dockOverlayCache, ...candidates]) {
      if (element) dockResizeObserver?.observe(element);
    }
  }

  function pictureKey(): string {
    const classes = document.documentElement.classList;
    return `${classes.contains('theater-everywhere-picture-top')}:${classes.contains('theater-everywhere-picture-moving')}`;
  }

  function updateCaptionDock(immediate = false): void {
    if (!ctx.session.element) {
      resetCaptionDock();
      document.documentElement.style.removeProperty('--theater-caption-bottom');
      return;
    }
    if (immediate) {
      cancelDockFrame?.();
      cancelDockFrame = null;
      if (!ctx.session.isIdle && !ctx.session.isExiting) measureCurrentCaptionDock(ctx.session.element)?.();
      return;
    }
    if (cancelDockFrame) return;
    const epoch = ctx.session.currentEpoch;
    const element = ctx.session.element;
    const stale = () => ctx.session.currentEpoch !== epoch || ctx.session.element !== element
      || ctx.session.isIdle || ctx.session.isExiting;
    // Measured with the frame's other readers, so host changes and their writes cost one restyle.
    cancelDockFrame = measureNextFrame(window, () => {
      cancelDockFrame = null;
      if (stale()) return;
      const write = measureCurrentCaptionDock(element);
      return write && (() => { if (!stale()) write(); });
    });
  }

  let captionDockLifted = false;
  const captionDockMotionMode = new WeakMap<HTMLElement, DockMotionState>();

  /** Reads the dock; the returned write places captions. */
  function measureCurrentCaptionDock(element: HTMLElement): (() => void) | void {
    // Updating the line cap can synchronously redraw overlay captions and call
    // back into this path. The outer write measures that updated height again.
    if (measuringCaptionDock) return;
    const write = guardCaptionDock(() => measureCaptionDock(element));
    return () => guardCaptionDock(write);
  }

  function guardCaptionDock<T>(run: () => T): T {
    measuringCaptionDock = true;
    try { return run(); } finally { measuringCaptionDock = false; }
  }

  /**
   * Reads every measurement the dock needs and returns the writes. A changed reserved height or
   * caption line cap moves what was measured, so its write measures again before placing.
   */
  function measureCaptionDock(element: HTMLElement, remeasured = 0): () => void {
    const settled = remeasured >= 2;
    refreshDockElements();
    // The UI keeps the full player viewport; only the media box loses the dock's height.
    const controlsHeight = controlsCache?.classList.contains('pinned') ? controlsCache.offsetHeight : 0;
    const root = document.documentElement;
    // An unpinned bar reserves nothing, which is the property's fallback. Leaving it unset spares
    // the page a restyle on entry: a change to the root's custom properties restyles every element.
    const reservedHeight = controlsHeight > 0 ? `${controlsHeight}px` : '';
    if (!settled && root.style.getPropertyValue('--theater-controls-reserved-height') !== reservedHeight) {
      return () => {
        if (reservedHeight) root.style.setProperty('--theater-controls-reserved-height', reservedHeight);
        else root.style.removeProperty('--theater-controls-reserved-height');
        pictureGeometryChanged();
        measureCaptionDock(element, remeasured + 1)();
      };
    }
    const mediaRect = element.getBoundingClientRect();
    const viewportWidth = mediaRect.width || window.innerWidth;
    const pictureHeight = mediaRect.height || window.innerHeight;
    const viewportHeight = pictureHeight + controlsHeight;
    const raised = document.documentElement.classList.contains('theater-everywhere-picture-top');
    const video = element instanceof HTMLVideoElement ? element : null;
    const band = raised ? horizontalLetterboxPx({
      videoWidth: video?.videoWidth ?? 0,
      videoHeight: video?.videoHeight ?? 0,
      viewportWidth, viewportHeight: pictureHeight
    }) : 0;
    const placeInBand = raised && band > 0;
    const overlay = dockOverlayCache?.classList.contains('visible') ? dockOverlayCache : null;
    const overlayText = overlay ? overlayTextCache : null;
    const features = controlsCache;
    const hostCaption = features?._mediaFeatures?.readHostCaptionLayout() ?? null;
    const motionTarget = hostCaption?.motionTarget ?? null;
    if (motionTarget !== nativeMotionTarget) {
      dockNativeObserver?.disconnect();
      nativeMotionTarget = motionTarget;
      dockNativeObserver = motionTarget ? new MutationObserver(() => updateCaptionDock()) : null;
      if (motionTarget) dockNativeObserver?.observe(motionTarget, { attributes: true, attributeFilter: ['style', 'class'] });
    }
    const overlayLineHeight = overlayText ? Number.parseFloat(getComputedStyle(overlayText).lineHeight) : 0;
    const lineHeight = overlayLineHeight > 0 ? overlayLineHeight : (hostCaption?.lineHeight ?? 0);
    const lineLimit = placeInBand ? raisedCaptionLineLimit(band, lineHeight) : CAPTION_LINE_LIMIT_MIN;
    const overlayCaption = overlay && overlayText && overlayText.textContent
      ? { width: overlay.offsetWidth, height: overlay.offsetHeight }
      : null;
    const captionSize = overlayCaption ?? hostCaption;

    const obstacles: DockRect[] = [];
    // The bar still paints while fading out. Keep captions clear until its
    // transition ends, just as contextual actions keep clear of the same bar.
    const controls = controlsCache && controlsBarShowing(controlsCache) ? controlsCache : null;
    if (controls) {
      const rect = controls.getBoundingClientRect();
      if (rect.width > 1 && rect.height > 1) {
        const bottomOffset = Number.parseFloat(getComputedStyle(controls).bottom) || 0;
        const bottom = mediaRect.bottom + controlsHeight - bottomOffset;
        obstacles.push({ left: rect.left, right: rect.right, top: bottom - controls.offsetHeight, bottom });
      }
    }
    for (const el of candidates) {
      if (!el.isConnected || !el.matches(obstacleSelector)) continue;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.05) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width > 1 && rect.height > 1) {
        obstacles.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
      }
    }

    const rows = overlayCaption
      ? raisedCaptionRowCount(overlayCaption.height, lineHeight)
      : hostCaption?.rows !== undefined
        ? hostCaption.rows
        : (captionSize ? raisedCaptionRowCount(captionSize.height, lineHeight) : 2);
    const restBottom = placeInBand
      ? controlsHeight + raisedCaptionRestBottom(
        band,
        captionSize?.height ?? 0,
        pictureHeight,
        CAPTION_DOCK_RAISED_EDGE,
        CAPTION_DOCK_RAISED_CENTER_GAP,
        rows
      )
      : controlsHeight > 0 ? controlsHeight + CAPTION_DOCK_REST_BOTTOM : undefined;
    const bottom = computeCaptionDockBottom({
      captionSize,
      obstacles,
      viewportWidth,
      viewportHeight,
      ...(restBottom !== undefined ? { restBottom } : {})
    });
    const lifted = restBottom !== undefined ? bottom > restBottom : bottom > CAPTION_DOCK_REST_BOTTOM;
    const pictureMoving = document.documentElement.classList.contains('theater-everywhere-picture-moving');
    // Our overlay glides with the control bar; a host renderer owns its own ease.
    const glide = !isMotionReduced();
    return () => {
      // A new cap redraws overlay captions at a new height; place them by that height.
      if (features?._mediaFeatures?.setCaptionLineLimit(lineLimit) && !settled && overlayCaption) {
        measureCaptionDock(element, remeasured + 1)();
        return;
      }
      // The bottom ease exists to clear the control bar. A row change at rest must
      // land in the same frame as the new height, or the block slides up or down.
      // A picture move is the exception: captions travel with the video.
      const motion = captionDockMotion(lifted || captionDockLifted, pictureMoving);
      applyCaptionDockMotion(dockOverlayCache, motion, captionDockMotionMode, glide);
      applyCaptionDockMotion(hostCaption?.motionTarget ?? null, motion, captionDockMotionMode);
      captionDockLifted = lifted;
      const nextBottom = `${bottom}px`;
      // The overlay reads its own copy. The page copy serves host caption renderers; while the
      // overlay replaces them it stays as it is, since a change to a custom property on <html>
      // restyles the whole host page on every bar show and hide.
      for (const target of [dockOverlayCache, root.classList.contains(OVERLAY_CAPTIONS_CLASS) ? null : root]) {
        if (target && target.style.getPropertyValue('--theater-caption-bottom') !== nextBottom) {
          target.style.setProperty('--theater-caption-bottom', nextBottom);
        }
      }
    };
  }

  // The picture carries the class instead of <html>: every element inherits `cursor`, so
  // changing it on <html> restyled the whole host page on each show and auto-hide.
  let cursorHiddenOn: HTMLElement | null = null;
  function hideCursorOn(target: HTMLElement | null): void {
    if (cursorHiddenOn !== target) cursorHiddenOn?.classList.remove(CURSOR_HIDDEN_CLASS);
    target?.classList.add(CURSOR_HIDDEN_CLASS);
    cursorHiddenOn = target;
  }

  // Bars whose fade-out has finished since they last lost `visible`. Opacity changes only
  // with that class, so the bar stays transparent until it is shown again and needs no
  // further style reads, which would force the host page's pending restyle.
  const fadedOutBars = new WeakSet<HTMLElement>();
  function controlsBarShowing(bar: HTMLElement): boolean {
    if (bar.classList.contains('visible')) {
      fadedOutBars.delete(bar);
      return true;
    }
    if (fadedOutBars.has(bar)) return false;
    // The bar still paints while fading out.
    if (Number.parseFloat(getComputedStyle(bar).opacity) > 0.01) return true;
    fadedOutBars.add(bar);
    return false;
  }

  function applyVisibility(active: boolean): void {
    if (ctx.ui().helpOpen && !ctx.refs.helpOverlay?.isConnected) ctx.actions.hideHelpOverlay(false);
    const controls = ctx.queryPlayerUi<HTMLElement>('.theater-controls-wrapper');
    if (!controls || !ctx.session.element) return;
    const header = ctx.queryPlayerUi<HTMLElement>(`.${HEADER_HUD_CLASS}`);
    const visibility = resolveChromeVisibility({
      active,
      pinned: ctx.ui().keepControlsVisible,
      controlsHovered: controls.matches(':hover'),
      scrubberDragging: controls.querySelector('.theater-scrubber-container.dragging') !== null,
      keyboardFocused: ctx.refs.toolbarKeyboardInteractionActive
        && (controls.querySelector(':focus-visible') !== null || Boolean(header?.querySelector(':focus-visible'))),
      headerActive: Boolean(header?.matches(':hover, :focus-within')),
      helpOpen: ctx.ui().helpOpen
    });

    if (!visibility.controlsVisible) {
      closeTheaterPopovers();
      ctx.queryPlayerUi('.theater-button-tooltip')?.classList.remove('visible');
    }
    controls.classList.toggle('pinned', ctx.ui().keepControlsVisible);
    const wasVisible = controls.classList.contains('visible');
    controls.classList.toggle('visible', visibility.controlsVisible);
    if (visibility.controlsVisible) fadedOutBars.delete(controls);
    if (visibility.controlsVisible && !wasVisible) (controls as ExtendedHTMLDivElement)._syncPlaybackChrome?.();
    if (header) {
      header.classList.toggle('visible', visibility.headerVisible);
      header.inert = !visibility.headerVisible;
    }
    if (ctx.session.element.tagName === 'VIDEO') {
      ctx.session.element.classList.toggle('controls-visible', visibility.controlsVisible);
    }
    hideCursorOn(visibility.cursorVisible ? null : ctx.session.element);
    ctx.uiStore.dispatch({ type: 'SET_TOOLBAR_VISIBLE', value: visibility.headerVisible });
    // Resolve the collision before the first frame of the controls' fade-in.
    updateCaptionDock(visibility.controlsVisible && !wasVisible);

    // Poll held interactions with the same timer, even when the bottom bar is pinned.
    if (visibility.cursorVisible) scheduleToolbarHide();
  }

  function hideToolbar(): void {
    applyVisibility(false);
  }

  function refreshToolbarVisibility(): void {
    applyVisibility(ctx.ui().toolbarVisible);
  }

  function showToolbar(event?: Event): void {
    if (event && performance.now() < ctx.refs.toolbarActivityBlockedUntil) return;
    if (event?.type === 'pointermove' || event?.type === 'pointerdown') {
      ctx.refs.toolbarKeyboardInteractionActive = false;
    } else if (event?.type === 'focusin') {
      ctx.refs.toolbarKeyboardInteractionActive = ctx.eventPathMatches(event, ':focus-visible');
    }
    applyVisibility(true);
  }

  function suppressToolbarActivity(): void {
    // Fullscreen transitions can synthesize pointer/focus activity without user input.
    ctx.refs.toolbarActivityBlockedUntil = performance.now() + FULLSCREEN_ACTIVITY_SUPPRESSION_MS;
  }

  function isPrimaryPointerEvent(event: Event): boolean {
    return !('button' in event) || (event as MouseEvent).button === 0;
  }

  function togglePictureFullscreen(): void {
    if (ctx.refs.currentToggleFullscreen) {
      ctx.refs.currentToggleFullscreen();
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(console.error);
      return;
    }
    document.documentElement.requestFullscreen().catch(console.error);
  }

  // Theater's picture: click plays/pauses, double-click toggles fullscreen
  // (theater stays active, so a second double-click returns to plain theater).
  // The listeners exist only while a theater session owns a <video>. The video
  // and the WASM catcher share this wiring; toolbar buttons and shortcuts call
  // executeCommand directly and never wait for the double-click window.
  function createPictureGate(canToggle: () => boolean): PictureClickGate {
    return createPictureClickGate({
      commit: () => {
        if (canToggle()) ctx.actions.executeCommand({ type: 'PLAY_PAUSE' });
      },
      fullscreen: togglePictureFullscreen,
      preview: () => {
        const action = canToggle() ? ctx.actions.nextPlaybackAction() : null;
        if (action) ctx.actions.triggerPlaybackIndicator(action);
      },
      revoke: () => ctx.actions.dismissPlaybackIndicator()
    });
  }

  const videoClicks = createPictureGate(() => ctx.session.element?.tagName === 'VIDEO');

  function preventDoubleToggle(e: Event): void {
    if (!ctx.session.element) return;
    if (!isPrimaryPointerEvent(e)) return;

    if (e.type !== 'dblclick') closeTheaterPopovers();

    if (e.type === 'dblclick') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (ctx.session.element.tagName === 'VIDEO') videoClicks.doubleClick();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    // A cancelled press cannot move focus, so a click on the picture would
    // otherwise leave shortcuts typing into a page field, chat or iframe.
    if (e.type === 'pointerdown') ctx.actions.focusTheaterPage();

    if (e.type === 'click' && ctx.session.element.tagName === 'VIDEO') {
      if (consumePictureDismiss()) videoClicks.cancel();
      else videoClicks.click();
    }
  }

  function bindWasmCatcher(catcher: HTMLElement): () => void {
    const clicks = createPictureGate(() => true);
    const onClick = (event: MouseEvent) => {
      if (!isPrimaryPointerEvent(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (consumePictureDismiss()) {
        clicks.cancel();
        return;
      }
      clicks.click();
    };
    const onDoubleClick = (event: MouseEvent) => {
      if (!isPrimaryPointerEvent(event)) return;
      event.preventDefault();
      event.stopPropagation();
      clicks.doubleClick();
    };
    catcher.addEventListener('click', onClick);
    catcher.addEventListener('dblclick', onDoubleClick);
    return () => {
      clicks.cancel();
      catcher.removeEventListener('click', onClick);
      catcher.removeEventListener('dblclick', onDoubleClick);
      catcher.remove();
    };
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  return {
    scheduleToolbarHide,
    refreshToolbarVisibility,
    showToolbar,
    suppressToolbarActivity,
    hideToolbar,
    updateCaptionDock,
    resetCaptionDock,
    controlsBarShowing,
    releaseCursor: () => hideCursorOn(null),
    closeTheaterPopovers,
    blurMouseToggle,
    preventDoubleToggle,
    cancelPictureClick: videoClicks.cancel,
    bindWasmCatcher,
    escapeHtml,
    setIcon: setSvgIcon,
    setTooltipContent: renderKbdText
  };
}
