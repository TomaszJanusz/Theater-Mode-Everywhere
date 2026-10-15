/** Focus follows the active control through our open shadow root. */
export function activeElementDeep(): HTMLElement | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active instanceof HTMLElement ? active : null;
}

/** Own modal keyboard focus and temporarily exclude the surrounding UI from AT. */
export function containModalFocus(dialog: HTMLElement, onEscape: () => void): (restoreFocus?: boolean) => void {
  const previous = activeElementDeep();
  const siblings = new Map<HTMLElement, boolean>();
  let branch: Node = dialog;
  while (branch.parentNode) {
    for (const sibling of branch.parentNode.childNodes) {
      if (sibling !== branch && sibling instanceof HTMLElement) {
        siblings.set(sibling, sibling.inert);
        sibling.inert = true;
      }
    }
    const parent = branch.parentNode;
    branch = parent instanceof ShadowRoot ? parent.host : parent;
  }
  const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
    'button, a[href], input, select, textarea, [tabindex]'
  )).filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[inert]')
    && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      onEscape();
    } else if (event.key === 'Tab') {
      const controls = focusable();
      const index = controls.indexOf(activeElementDeep()!);
      if (index < 0 || (event.shiftKey ? index === 0 : index === controls.length - 1)) {
        event.preventDefault();
        (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
      }
    }
  };
  document.addEventListener('keydown', onKeyDown, true);
  let disposed = false;
  return (restoreFocus = true) => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    for (const [element, inert] of siblings) element.inert = inert;
    if (restoreFocus && previous?.isConnected && !previous.closest('[inert]')) previous.focus();
  };
}
