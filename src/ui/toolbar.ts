import {
  CAPTION_DOCK_RAISED_CENTER_GAP,
  CAPTION_DOCK_RAISED_EDGE,
  CAPTION_DOCK_REST_BOTTOM,
  CAPTION_LINE_LIMIT_MIN,
  captionDockMotion,
  computeCaptionDockBottom,
  raisedCaptionLineLimit,
  raisedCaptionRestBottom,
  raisedCaptionRowCount,
  type DockRect
} from '../media-features/caption-dock';
import { horizontalLetterboxPx } from './appearance';
import { HEADER_HUD_CLASS } from './hud';
import { resolveChromeVisibility } from './controls-visibility';
import { closeMenuPopover } from './menu-popover';
import { closePlayerSettings } from './player-settings';
import type { PlayerChromeContext } from './runtime-context';
import type { HostCaptionLayout } from '../media-features/types';

export const TOOLBAR_AUTO_HIDE_DELAY_MS = 2500;
export const CURSOR_HIDDEN_CLASS = 'theater-everywhere-cursor-hidden';

function applyCaptionDockMotion(
  el: HTMLElement | null,
  motion: ReturnType<typeof captionDockMotion>,
  modes: WeakMap<HTMLElement, ReturnType<typeof captionDockMotion>>
): void {
  if (!el) return;
  // A host renderer can rewrite its inline styles during cue replacement.
  const transition = motion === 'moving'
    ? 'bottom 0.32s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.15s'
    : motion === 'lifted' ? 'none' : 'opacity 0.15s';
  if (modes.get(el) === motion && el.style.getPropertyValue('transition') === transition
    && el.style.getPropertyPriority('transition') === 'important') return;
  if (motion === 'moving') {
    el.style.setProperty(
      'transition',
      'bottom 0.32s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.15s ease',
      'important'
    );
  } else if (motion === 'lifted') el.style.setProperty('transition', 'none', 'important');
  else el.style.setProperty('transition', 'opacity 0.15s ease', 'important');
  void el.offsetWidth;
  modes.set(el, motion);
}

export function createToolbar(ctx: PlayerChromeContext) {
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
    '.theater-volume-container:hover .theater-volume-panel',
    '.theater-speed-container:hover .theater-speed-panel',
    '.theater-volume-container:focus-within .theater-volume-panel',
    '.theater-speed-container:focus-within .theater-speed-panel'
  ].join(',');
  const candidateSelector = '.theater-service-action-host, .theater-scrubber-tooltip, .theater-cc-menu, '
    + '.theater-settings-menu, .theater-button-tooltip, .theater-volume-panel, .theater-speed-panel';
  let dockFrame: number | null = null;
  let measuringCaptionDock = false;
  let controlsCache: (HTMLElement & {
    _mediaFeatures?: {
      setCaptionLineLimit(maxLines: number): void;
      readHostCaptionLayout(): HostCaptionLayout | null;
    };
  }) | null = null;
  let dockOverlayCache: HTMLElement | null = null;
  let overlayTextCache: HTMLElement | null = null;
  let candidates: Element[] = [];
  let candidatesDirty = true;
  let dockObserver: MutationObserver | null = null;
  let dockResizeObserver: ResizeObserver | null = null;

  function resetCaptionDock(): void {
    if (dockFrame !== null) window.cancelAnimationFrame(dockFrame);
    dockFrame = null;
    dockObserver?.disconnect();
    dockResizeObserver?.disconnect();
    dockObserver = null;
    dockResizeObserver = null;
    controlsCache = null;
    dockOverlayCache = null;
    overlayTextCache = null;
    candidates = [];
    candidatesDirty = true;
    captionDockLifted = false;
  }

  function refreshDockElements(): void {
    if (!controlsCache?.isConnected) {
      dockObserver?.disconnect();
      dockResizeObserver?.disconnect();
      controlsCache = ctx.queryPlayerUi('.theater-controls-wrapper');
      if (!controlsCache) return;
      candidatesDirty = true;
      const root = controlsCache.getRootNode();
      dockObserver = new MutationObserver(records => {
        // Visibility changes reuse the cached nodes; only changed structure
        // requires discovery. Text and style changes still update geometry.
        if (records.some(record => record.type === 'childList'
          && [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === Node.ELEMENT_NODE))) {
          candidatesDirty = true;
        }
        updateCaptionDock();
      });
      dockObserver.observe(root, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['class', 'style']
      });
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

  function updateCaptionDock(immediate = false): void {
    if (!ctx.session.element) {
      resetCaptionDock();
      document.documentElement.style.removeProperty('--theater-caption-bottom');
      return;
    }
    if (immediate) {
      if (dockFrame !== null) window.cancelAnimationFrame(dockFrame);
      dockFrame = null;
      if (!ctx.session.isIdle && !ctx.session.isExiting) measureCurrentCaptionDock(ctx.session.element);
      return;
    }
    if (dockFrame !== null) return;
    const epoch = ctx.session.currentEpoch;
    const element = ctx.session.element;
    dockFrame = window.requestAnimationFrame(() => {
      dockFrame = null;
      if (ctx.session.currentEpoch !== epoch || ctx.session.element !== element
        || ctx.session.isIdle || ctx.session.isExiting) return;
      measureCurrentCaptionDock(element);
    });
  }

  let captionDockLifted = false;
  const captionDockMotionMode = new WeakMap<HTMLElement, ReturnType<typeof captionDockMotion>>();

  function measureCurrentCaptionDock(element: HTMLElement): void {
    // Updating the line cap can synchronously redraw overlay captions and call
    // back into this path. The outer measurement reads that updated height.
    if (measuringCaptionDock) return;
    measuringCaptionDock = true;
    try { measureCaptionDock(element); } finally { measuringCaptionDock = false; }
  }

  function measureCaptionDock(element: HTMLElement): void {
    refreshDockElements();
    const mediaRect = element.getBoundingClientRect();
    const viewportWidth = mediaRect.width || window.innerWidth;
    const viewportHeight = mediaRect.height || window.innerHeight;
    const raised = document.documentElement.classList.contains('theater-everywhere-picture-top');
    const video = element instanceof HTMLVideoElement ? element : null;
    const band = raised ? horizontalLetterboxPx({
      videoWidth: video?.videoWidth ?? 0,
      videoHeight: video?.videoHeight ?? 0,
      viewportWidth, viewportHeight
    }) : 0;
    const placeInBand = raised && band > 0;
    const overlay = dockOverlayCache?.classList.contains('visible') ? dockOverlayCache : null;
    const overlayText = overlay ? overlayTextCache : null;
    const features = controlsCache;
    const hostCaption = features?._mediaFeatures?.readHostCaptionLayout() ?? null;
    const overlayLineHeight = overlayText ? Number.parseFloat(getComputedStyle(overlayText).lineHeight) : 0;
    const lineHeight = overlayLineHeight > 0 ? overlayLineHeight : (hostCaption?.lineHeight ?? 0);
    const lineLimit = placeInBand ? raisedCaptionLineLimit(band, lineHeight) : CAPTION_LINE_LIMIT_MIN;
    features?._mediaFeatures?.setCaptionLineLimit(lineLimit);
    const overlayCaption = overlay && overlayText && overlayText.textContent
      ? { width: overlay.offsetWidth, height: overlay.offsetHeight }
      : null;
    const captionSize = overlayCaption ?? hostCaption;

    const obstacles: DockRect[] = [];
    const controls = controlsCache?.classList.contains('visible') ? controlsCache : null;
    if (controls) {
      const rect = controls.getBoundingClientRect();
      if (rect.width > 1 && rect.height > 1) {
        const bottomOffset = Number.parseFloat(getComputedStyle(controls).bottom) || 0;
        const bottom = mediaRect.bottom - bottomOffset;
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
      ? raisedCaptionRestBottom(
        band,
        captionSize?.height ?? 0,
        viewportHeight,
        CAPTION_DOCK_RAISED_EDGE,
        CAPTION_DOCK_RAISED_CENTER_GAP,
        rows
      )
      : undefined;
    const bottom = computeCaptionDockBottom({
      captionSize,
      obstacles,
      viewportWidth,
      viewportHeight,
      ...(restBottom !== undefined ? { restBottom } : {})
    });
    const lifted = restBottom !== undefined ? bottom > restBottom : bottom > CAPTION_DOCK_REST_BOTTOM;
    const pictureMoving = document.documentElement.classList.contains('theater-everywhere-picture-moving');
    // The bottom ease exists to clear the control bar. A row change at rest must
    // land in the same frame as the new height, or the block slides up or down.
    // A picture move is the exception: captions travel with the video.
    const motion = captionDockMotion(lifted || captionDockLifted, pictureMoving);
    applyCaptionDockMotion(dockOverlayCache, motion, captionDockMotionMode);
    applyCaptionDockMotion(hostCaption?.motionTarget ?? null, motion, captionDockMotionMode);
    captionDockLifted = lifted;
    const nextBottom = `${bottom}px`;
    if (document.documentElement.style.getPropertyValue('--theater-caption-bottom') !== nextBottom) {
      document.documentElement.style.setProperty('--theater-caption-bottom', nextBottom);
    }
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
    controls.classList.toggle('visible', visibility.controlsVisible);
    if (header) {
      header.classList.toggle('visible', visibility.headerVisible);
      header.inert = !visibility.headerVisible;
    }
    if (ctx.session.element.tagName === 'VIDEO') {
      ctx.session.element.classList.toggle('controls-visible', visibility.controlsVisible);
    }
    document.documentElement.classList.toggle(CURSOR_HIDDEN_CLASS, !visibility.cursorVisible);
    ctx.uiStore.dispatch({ type: 'SET_TOOLBAR_VISIBLE', value: visibility.headerVisible });
    updateCaptionDock();

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
    if (event?.type === 'pointermove' || event?.type === 'pointerdown') {
      ctx.refs.toolbarKeyboardInteractionActive = false;
    } else if (event?.type === 'focusin') {
      ctx.refs.toolbarKeyboardInteractionActive = ctx.eventPathMatches(event, ':focus-visible');
    }
    applyVisibility(true);
  }

  function isPrimaryPointerEvent(event: Event): boolean {
    return !('button' in event) || (event as MouseEvent).button === 0;
  }

  function preventDoubleToggle(e: Event): void {
    if (!ctx.session.element) return;
    if (!isPrimaryPointerEvent(e)) return;

    if (e.type !== 'dblclick') closeTheaterPopovers();

    if (e.type === 'dblclick') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (e.type === 'click' && ctx.session.element.tagName === 'VIDEO') {
      ctx.actions.executeCommand({ type: 'PLAY_PAUSE' });
    }
  }

  function bindWasmCatcher(catcher: HTMLElement): () => void {
    let clickTimer: number | null = null;
    const clearClick = () => {
      if (clickTimer == null) return;
      window.clearTimeout(clickTimer);
      clickTimer = null;
    };
    const onClick = (event: MouseEvent) => {
      if (!isPrimaryPointerEvent(event)) return;
      event.preventDefault();
      event.stopPropagation();
      clearClick();
      clickTimer = window.setTimeout(() => {
        clickTimer = null;
        ctx.actions.executeCommand({ type: 'PLAY_PAUSE' });
      }, 280);
    };
    const onDoubleClick = (event: MouseEvent) => {
      if (!isPrimaryPointerEvent(event)) return;
      event.preventDefault();
      event.stopPropagation();
      clearClick();
      if (ctx.refs.currentToggleFullscreen) {
        ctx.refs.currentToggleFullscreen();
        return;
      }
      if (document.fullscreenElement) {
        void document.exitFullscreen();
        return;
      }
      void document.documentElement.requestFullscreen();
    };
    catcher.addEventListener('click', onClick);
    catcher.addEventListener('dblclick', onDoubleClick);
    return () => {
      clearClick();
      catcher.removeEventListener('click', onClick);
      catcher.removeEventListener('dblclick', onDoubleClick);
      catcher.remove();
    };
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function setIcon(el: HTMLElement, svgStr: string): void {
    el.textContent = '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgStr.trim(), 'image/svg+xml');
    el.appendChild(doc.documentElement);
  }

  function setTooltipContent(el: HTMLElement, rawText: string): void {
    el.textContent = '';
    const kbdRe = /<kbd>(.*?)<\/kbd>/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = kbdRe.exec(rawText)) !== null) {
      if (m.index > last) el.appendChild(document.createTextNode(rawText.slice(last, m.index)));
      const kbd = document.createElement('kbd');
      kbd.textContent = m[1];
      el.appendChild(kbd);
      last = m.index + m[0].length;
    }
    if (last < rawText.length) el.appendChild(document.createTextNode(rawText.slice(last)));
  }

  return {
    scheduleToolbarHide,
    refreshToolbarVisibility,
    showToolbar,
    hideToolbar,
    updateCaptionDock,
    resetCaptionDock,
    closeTheaterPopovers,
    blurMouseToggle,
    preventDoubleToggle,
    bindWasmCatcher,
    escapeHtml,
    setIcon,
    setTooltipContent
  };
}
