import type { DisposableScope } from '../core/disposable-scope';
import { armPictureDismissOnLeave } from './picture-dismiss';

const OPEN_CLASS = 'is-open';
const PINNED_CLASS = 'visible';
const SUPPRESS_CLASS = 'is-suppressed';

function releaseMenuPosition(panel: HTMLElement): void {
  panel.classList.remove('is-position-held');
  panel.style.removeProperty('--theater-menu-held-left');
}

/** Keep a settings slider under the pointer as the video/bar changes width.
 * Hold until the menu closes, so pointerup does not move it either. */
export function holdMenuPosition(panel: HTMLElement): void {
  if (panel.classList.contains('is-position-held')) return;
  const parent = panel.offsetParent;
  if (!(parent instanceof HTMLElement)) return;
  const left = panel.getBoundingClientRect().left - parent.getBoundingClientRect().left;
  panel.style.setProperty('--theater-menu-held-left', `${left}px`);
  panel.classList.add('is-position-held');
}

/**
 * Close a hover/click menu. A following hover does not reopen it until the
 * pointer leaves and comes back, so Escape and outside clicks stay closed.
 */
export function closeMenuPopover(host: HTMLElement | null | undefined, restoreFocus = false): boolean {
  if (!host) return false;
  const panel = host.querySelector<HTMLElement>(':scope > .theater-menu-panel');
  const trigger = host.querySelector<HTMLButtonElement>(':scope > button');
  if (!panel || !trigger) return false;
  const open = host.classList.contains(OPEN_CLASS) || panel.classList.contains(PINNED_CLASS);
  if (!open) return false;
  panel.classList.remove(PINNED_CLASS);
  host.classList.remove(OPEN_CLASS);
  host.classList.add(SUPPRESS_CLASS);
  releaseMenuPosition(panel);
  trigger.setAttribute('aria-expanded', 'false');
  panel.inert = true;
  const active = (panel.getRootNode() as Document | ShadowRoot).activeElement;
  if (restoreFocus) trigger.focus();
  else if (active instanceof HTMLElement && panel.contains(active)) active.blur();
  return true;
}

/** Scroll a list so its active row sits as near the middle as the ends allow. */
function centerActiveRow(list: HTMLElement | null): void {
  const active = list?.querySelector<HTMLElement>('.active');
  if (!list || !active) return;
  const listRect = list.getBoundingClientRect();
  if (listRect.height === 0) return;
  const rowRect = active.getBoundingClientRect();
  const rowCenter = rowRect.top - listRect.top + list.scrollTop + rowRect.height / 2;
  list.scrollTop = Math.max(0, Math.min(rowCenter - list.clientHeight / 2, list.scrollHeight - list.clientHeight));
}

/**
 * One menu shell for the player bar. Hover reveals it. A click pins it open
 * after the pointer leaves, and a second click closes it. Keyboard activation
 * pins it and moves focus inside.
 */
export function bindMenuPopover(options: {
  host: HTMLElement;
  trigger: HTMLButtonElement;
  panel: HTMLElement;
  scope: DisposableScope;
  onBeforeOpen?: () => void;
  prepare?: () => void;
  /** Overrides the first button, for panels whose leading rows can be hidden. */
  firstFocus?: () => HTMLElement | undefined;
  /** Selector for a scrollable list inside the panel; opening centers its `.active` row. */
  centerActiveIn?: string;
  onKeyboardOpen?: () => void;
  onChange?: () => void;
}): { close: (restoreFocus?: boolean) => boolean } {
  const { host, trigger, panel, scope } = options;
  host.classList.add('theater-menu');
  panel.classList.add('theater-menu-panel');

  const syncExpanded = () => {
    const open = host.classList.contains(OPEN_CLASS) || panel.classList.contains(PINNED_CLASS);
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.inert = !open;
  };
  syncExpanded();
  const close = (restoreFocus = false) => {
    const closed = closeMenuPopover(host, restoreFocus);
    if (closed) options.onChange?.();
    return closed;
  };
  scope.listen(host, 'keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !close(true)) return;
    event.preventDefault();
    event.stopPropagation();
  });
  const list = () => (options.centerActiveIn ? panel.querySelector<HTMLElement>(options.centerActiveIn) : null);
  const isOpen = () => host.classList.contains(OPEN_CLASS) || panel.classList.contains(PINNED_CLASS);
  // Once the user scrolls, re-renders keep their position instead of re-centering.
  let userScrolled = false;
  let lastScrollTop = 0;
  if (options.centerActiveIn) {
    const markUserScroll = () => { userScrolled = true; };
    for (const type of ['wheel', 'touchmove', 'pointerdown', 'keydown'] as const) {
      scope.listen(panel, type, markUserScroll, { passive: true });
    }
    scope.listen(panel, 'scroll', (event: Event) => {
      if (event.target instanceof HTMLElement && event.target.matches(options.centerActiveIn!)) {
        lastScrollTop = event.target.scrollTop;
      }
    }, { capture: true, passive: true });
    // Providers rebuild the list while the menu is open, which resets its scroll.
    const observer = new MutationObserver(() => {
      if (!isOpen()) return;
      const next = list();
      if (!next) return;
      if (userScrolled) next.scrollTop = lastScrollTop;
      else centerActiveRow(next);
    });
    observer.observe(panel, { childList: true });
    scope.add(() => observer.disconnect());
  }
  const show = (pin: boolean, focusFirst: boolean) => {
    const already = host.classList.contains(OPEN_CLASS) || panel.classList.contains(PINNED_CLASS);
    options.onBeforeOpen?.();
    if (!already) {
      releaseMenuPosition(panel);
      options.prepare?.();
    }
    host.classList.remove(SUPPRESS_CLASS);
    host.classList.add(OPEN_CLASS);
    if (pin) panel.classList.add(PINNED_CLASS);
    syncExpanded();
    if (focusFirst) (options.firstFocus?.() ?? panel.querySelector<HTMLButtonElement>('button'))?.focus({ preventScroll: true });
    if (!already) {
      userScrolled = false;
      centerActiveRow(list());
    }
    options.onChange?.();
  };

  scope.listen(host, 'pointerenter', () => {
    host.classList.remove(SUPPRESS_CLASS);
    if (panel.classList.contains(PINNED_CLASS)) {
      host.classList.add(OPEN_CLASS);
      syncExpanded();
      options.onChange?.();
      return;
    }
    show(false, false);
  });
  scope.listen(host, 'pointerleave', (event: PointerEvent) => {
    // The following picture click only closes this menu.
    armPictureDismissOnLeave(event, host);
    if (!panel.classList.contains(PINNED_CLASS)) {
      host.classList.remove(OPEN_CLASS);
      releaseMenuPosition(panel);
    }
    window.requestAnimationFrame(() => {
      syncExpanded();
      options.onChange?.();
    });
  });
  let ignoreFocusLeave = false;
  const blurTrigger = () => {
    ignoreFocusLeave = true;
    trigger.blur();
    ignoreFocusLeave = false;
  };
  scope.listen(trigger, 'click', (event: MouseEvent) => {
    if (event.detail === 0) {
      show(true, true);
      options.onKeyboardOpen?.();
      return;
    }
    if (panel.classList.contains(PINNED_CLASS)) {
      close();
      blurTrigger();
      return;
    }
    show(true, false);
    blurTrigger();
  });

  const closeOnFocusLeave = (event: FocusEvent) => {
    if (ignoreFocusLeave) return;
    const next = event.relatedTarget;
    if (next instanceof Node && host.contains(next)) return;
    close();
  };
  scope.listen(panel, 'focusout', closeOnFocusLeave);
  scope.listen(trigger, 'focusout', closeOnFocusLeave);
  scope.listen(window, 'resize', () => releaseMenuPosition(panel));

  return { close };
}

/** Slider panels follow the existing hover/focus presentation, including AT visibility. */
export function bindSliderPopover(host: HTMLElement, panel: HTMLElement, scope: DisposableScope): void {
  let hovered = false;
  let suppressed = false;
  const sync = () => {
    const active = (host.getRootNode() as Document | ShadowRoot).activeElement;
    panel.inert = suppressed || (!hovered && !(active instanceof Node && host.contains(active)));
    panel.style.visibility = suppressed ? 'hidden' : '';
  };
  panel.inert = true;
  scope.listen(host, 'pointerenter', () => { hovered = true; suppressed = false; sync(); });
  scope.listen(host, 'pointerleave', () => { hovered = false; sync(); });
  scope.listen(host, 'focusin', sync);
  scope.listen(host, 'keydown', (event: KeyboardEvent) => {
    // Only an open panel owns Escape; once it is closed with focus left on the button, Escape exits theater again.
    if (event.key !== 'Escape' || panel.inert) return;
    event.preventDefault();
    event.stopPropagation();
    host.querySelector('button')?.focus();
    suppressed = true;
    sync();
  });
  scope.listen(host, 'focusout', (event: FocusEvent) => {
    const inside = event.relatedTarget instanceof Node && host.contains(event.relatedTarget);
    if (!inside) suppressed = false;
    panel.inert = suppressed || (!hovered && !inside);
    panel.style.visibility = suppressed ? 'hidden' : '';
  });
}
