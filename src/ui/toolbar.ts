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
import { closePlayerSettings } from './player-settings';
import type { PlayerChromeContext } from './runtime-context';

export const TOOLBAR_AUTO_HIDE_DELAY_MS = 2500;
export const CURSOR_HIDDEN_CLASS = 'theater-everywhere-cursor-hidden';

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
    ctx.queryPlayerUi('.theater-cc-menu')?.classList.remove('visible');
    for (const el of ctx.queryPlayerUiAll<HTMLElement>(
      '.theater-volume-container button, .theater-volume-container input, .theater-speed-container button, .theater-speed-container input'
    )) {
      el.blur();
    }
  }

  function blurMouseToggle(event: MouseEvent, button: HTMLElement): void {
    if (event.detail >= 1) button.blur();
  }

  function isPaintedOverlay(el: Element | null): el is Element {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.05) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  function overlayRect(el: Element): DockRect {
    const rect = el.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  }

  function chromeLayoutRect(el: HTMLElement): DockRect {
    const rect = el.getBoundingClientRect();
    const bottomOffset = Number.parseFloat(getComputedStyle(el).bottom) || 0;
    const bottom = window.innerHeight - bottomOffset;
    return {
      left: rect.left,
      right: rect.right,
      top: bottom - el.offsetHeight,
      bottom
    };
  }

  function raisedLetterbox(): { band: number; viewportHeight: number } {
    const element = ctx.session.element;
    const video = element instanceof HTMLVideoElement ? element : null;
    const rect = element?.getBoundingClientRect();
    const viewportWidth = rect && rect.width > 0 ? rect.width : window.innerWidth;
    const viewportHeight = rect && rect.height > 0 ? rect.height : window.innerHeight;
    return {
      band: horizontalLetterboxPx({
        videoWidth: video?.videoWidth ?? 0,
        videoHeight: video?.videoHeight ?? 0,
        viewportWidth,
        viewportHeight
      }),
      viewportHeight
    };
  }

  let captionDockLifted = false;
  const captionDockMotionMode = new WeakMap<HTMLElement, ReturnType<typeof captionDockMotion>>();

  function updateCaptionDock(): void {
    if (!ctx.session.element) {
      document.documentElement.style.removeProperty('--theater-caption-bottom');
      return;
    }

    const raised = document.documentElement.classList.contains('theater-everywhere-picture-top');
    const { band, viewportHeight } = raised ? raisedLetterbox() : { band: 0, viewportHeight: 0 };
    const placeInBand = raised && band > 0;
    const overlay = ctx.queryPlayerUi('.theater-caption-overlay.visible') as HTMLElement | null;
    const overlayText = overlay?.querySelector('.theater-caption-overlay-text') as HTMLElement | null;
    const lineHeight = overlayText ? Number.parseFloat(getComputedStyle(overlayText).lineHeight) : 0;
    const lineLimit = placeInBand ? raisedCaptionLineLimit(band, lineHeight) : CAPTION_LINE_LIMIT_MIN;
    const features = ctx.queryPlayerUi('.theater-controls-wrapper') as { _mediaFeatures?: { setCaptionLineLimit(maxLines: number): void } } | null;
    features?._mediaFeatures?.setCaptionLineLimit(lineLimit);

    const captionSize = overlay && overlayText && overlayText.textContent
      ? { width: overlay.offsetWidth, height: overlay.offsetHeight }
      : null;

    const obstacles: DockRect[] = [];
    const controls = ctx.queryPlayerUi('.theater-controls-wrapper.visible') as HTMLElement | null;
    if (controls && controls.offsetWidth > 1 && controls.offsetHeight > 1) {
      obstacles.push(chromeLayoutRect(controls));
    }
    for (const selector of [
      '.theater-scrubber-tooltip.visible',
      '.theater-cc-menu.visible',
      '.theater-settings-menu.visible',
      '.theater-settings-container:hover:not(.is-suppressed) .theater-settings-menu',
      '.theater-button-tooltip.visible',
      '.theater-volume-container:hover .theater-volume-panel',
      '.theater-speed-container:hover .theater-speed-panel',
      '.theater-volume-container:focus-within .theater-volume-panel',
      '.theater-speed-container:focus-within .theater-speed-panel'
    ]) {
      ctx.queryPlayerUiAll(selector).forEach((el) => {
        if (isPaintedOverlay(el)) obstacles.push(overlayRect(el));
      });
    }

    const rows = captionSize ? raisedCaptionRowCount(captionSize.height, lineHeight) : 2;
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
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      ...(restBottom !== undefined ? { restBottom } : {})
    });
    const lifted = restBottom !== undefined ? bottom > restBottom : bottom > CAPTION_DOCK_REST_BOTTOM;
    const pictureMoving = document.documentElement.classList.contains('theater-everywhere-picture-moving');
    // The bottom ease exists to clear the control bar. A row change at rest must
    // land in the same frame as the new height, or the block slides up or down.
    // A picture move is the exception: captions travel with the video.
    const motion = captionDockMotion(lifted || captionDockLifted, pictureMoving);
    const dockOverlay = (overlay ?? ctx.queryPlayerUi('.theater-caption-overlay')) as HTMLElement | null;
    if (dockOverlay && captionDockMotionMode.get(dockOverlay) !== motion) {
      if (motion === 'moving') {
        dockOverlay.style.setProperty(
          'transition',
          'bottom 0.32s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.15s ease',
          'important'
        );
      } else if (motion === 'lifted') dockOverlay.style.removeProperty('transition');
      else dockOverlay.style.setProperty('transition', 'opacity 0.15s ease', 'important');
      void dockOverlay.offsetWidth;
      captionDockMotionMode.set(dockOverlay, motion);
    }
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
    closeTheaterPopovers,
    blurMouseToggle,
    preventDoubleToggle,
    bindWasmCatcher,
    escapeHtml,
    setIcon,
    setTooltipContent
  };
}
