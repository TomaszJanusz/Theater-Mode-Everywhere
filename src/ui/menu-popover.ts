import type { DisposableScope } from '../core/disposable-scope';

const OPEN_CLASS = 'is-open';
const PINNED_CLASS = 'visible';
const SUPPRESS_CLASS = 'is-suppressed';

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
  trigger.setAttribute('aria-expanded', 'false');
  const active = (panel.getRootNode() as Document | ShadowRoot).activeElement;
  if (restoreFocus) trigger.focus();
  else if (active instanceof HTMLElement && panel.contains(active)) active.blur();
  return true;
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
  onKeyboardOpen?: () => void;
  onChange?: () => void;
}): { close: (restoreFocus?: boolean) => boolean } {
  const { host, trigger, panel, scope } = options;
  host.classList.add('theater-menu');
  panel.classList.add('theater-menu-panel');

  const syncExpanded = () => {
    const open = host.classList.contains(OPEN_CLASS) || panel.classList.contains(PINNED_CLASS);
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  const close = (restoreFocus = false) => {
    const closed = closeMenuPopover(host, restoreFocus);
    if (closed) options.onChange?.();
    return closed;
  };
  const show = (pin: boolean, focusFirst: boolean) => {
    const already = host.classList.contains(OPEN_CLASS) || panel.classList.contains(PINNED_CLASS);
    options.onBeforeOpen?.();
    if (!already) options.prepare?.();
    host.classList.remove(SUPPRESS_CLASS);
    host.classList.add(OPEN_CLASS);
    if (pin) panel.classList.add(PINNED_CLASS);
    syncExpanded();
    if (focusFirst) panel.querySelector<HTMLButtonElement>('button')?.focus();
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
  scope.listen(host, 'pointerleave', () => {
    if (!panel.classList.contains(PINNED_CLASS)) host.classList.remove(OPEN_CLASS);
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

  return { close };
}
