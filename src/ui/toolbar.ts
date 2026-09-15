import { computeCaptionDockBottom, type DockRect } from '../media-features/caption-dock';
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

  function shouldKeepToolbarVisible(controls: HTMLElement): boolean {
    const isScrubberDragging = controls.querySelector('.theater-scrubber-container.dragging') !== null;
    const hasKeyboardFocus = ctx.refs.toolbarKeyboardInteractionActive && controls.querySelector(':focus-visible') !== null;

    return controls.matches(':hover') || isScrubberDragging || hasKeyboardFocus || ctx.ui().helpOpen;
  }

  function closeTheaterPopovers(): void {
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

  function updateCaptionDock(): void {
    if (!ctx.session.element) {
      document.documentElement.style.removeProperty('--theater-caption-bottom');
      return;
    }

    const overlay = ctx.queryPlayerUi('.theater-caption-overlay.visible') as HTMLElement | null;
    const overlayText = overlay?.querySelector('.theater-caption-overlay-text') as HTMLElement | null;
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

    const bottom = computeCaptionDockBottom({
      captionSize,
      obstacles,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    });
    document.documentElement.style.setProperty('--theater-caption-bottom', `${bottom}px`);
  }

  function hideToolbar(): void {
    const controls = ctx.queryPlayerUi('.theater-controls-wrapper') as HTMLElement | null;
    if (!controls || !ctx.session.element) return;

    if (shouldKeepToolbarVisible(controls)) {
      scheduleToolbarHide();
      return;
    }

    closeTheaterPopovers();
    controls.classList.remove('visible');
    if (ctx.session.element.tagName === 'VIDEO') {
      ctx.session.element.classList.remove('controls-visible');
    }
    ctx.queryPlayerUi('.theater-button-tooltip')?.classList.remove('visible');
    document.documentElement.classList.add(CURSOR_HIDDEN_CLASS);
    ctx.uiStore.dispatch({ type: 'SET_TOOLBAR_VISIBLE', value: false });
    updateCaptionDock();
  }

  function showToolbar(event?: Event): void {
    const controls = ctx.queryPlayerUi('.theater-controls-wrapper') as HTMLElement | null;
    if (!controls) return;

    if (event?.type === 'pointermove' || event?.type === 'pointerdown') {
      ctx.refs.toolbarKeyboardInteractionActive = false;
    } else if (event?.type === 'focusin') {
      ctx.refs.toolbarKeyboardInteractionActive = ctx.eventPathMatches(event, ':focus-visible');
    }

    controls.classList.add('visible');
    if (ctx.session.element && ctx.session.element.tagName === 'VIDEO') {
      ctx.session.element.classList.add('controls-visible');
    }
    document.documentElement.classList.remove(CURSOR_HIDDEN_CLASS);
    ctx.uiStore.dispatch({ type: 'SET_TOOLBAR_VISIBLE', value: true });

    scheduleToolbarHide();
    updateCaptionDock();
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
    showToolbar,
    hideToolbar,
    updateCaptionDock,
    closeTheaterPopovers,
    blurMouseToggle,
    preventDoubleToggle,
    escapeHtml,
    setIcon,
    setTooltipContent
  };
}
