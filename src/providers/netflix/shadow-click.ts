const NETFLIX_UI_HOST_ID = 'theater-everywhere-ui';

function isCheckable(target: EventTarget | null): target is HTMLInputElement {
  return target instanceof HTMLInputElement && (target.type === 'checkbox' || target.type === 'radio');
}

function labeledCheckable(target: Element): HTMLInputElement | null {
  const label = target instanceof HTMLLabelElement ? target : target.closest('label');
  if (!label) return null;
  const nested = label.querySelector('input');
  if (isCheckable(nested)) return nested;
  const root = label.getRootNode();
  if (!label.htmlFor || !(root instanceof Document || root instanceof ShadowRoot)) return null;
  const labeled = root.getElementById(label.htmlFor);
  return isCheckable(labeled) ? labeled : null;
}

function isActivatingControl(node: EventTarget): node is HTMLButtonElement | HTMLAnchorElement | HTMLInputElement | HTMLLabelElement {
  return node instanceof HTMLButtonElement
    || node instanceof HTMLAnchorElement
    || node instanceof HTMLInputElement
    || node instanceof HTMLLabelElement;
}

/** The clicked node, or the button/link/input/label that contains an icon or span. */
function activatingControl(path: readonly EventTarget[]): Element | null {
  for (const node of path) {
    if (isActivatingControl(node)) return node;
  }
  const hit = path[0];
  if (!(hit instanceof Element)) return null;
  return hit.closest('button, a, input, label');
}

/**
 * Netflix's window capture listener swallows composed clicks before they reach
 * a shadow-root control. A click on an SVG path or span inside a button is
 * composed too. The closed click is delivered to the button, link, input, or
 * label, not left on the icon.
 *
 * stopImmediatePropagation does not cancel the original default. Checkbox
 * click() already toggled in legacy pre-activation, and a second click default
 * toggles it back. An anchor runs its default for the original event and again
 * for the synthetic one. Checkable controls keep the original default and cancel
 * only the synthetic one. Anchors and other controls cancel the original and
 * keep one synthetic default.
 */
export function relayNetflixShadowClick(event: Event, hostId = NETFLIX_UI_HOST_ID): boolean {
  if (!(event instanceof MouseEvent) || !event.composed || !event.bubbles) return false;
  const path = event.composedPath();
  const control = activatingControl(path);
  if (!control) return false;
  if (!path.some((node) => node instanceof Element && node.id === hostId)) return false;
  const keepOriginalDefault = isCheckable(control) || labeledCheckable(control) !== null;
  event.stopImmediatePropagation();
  if (!keepOriginalDefault) event.preventDefault();
  const synthetic = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    composed: false,
    clientX: event.clientX,
    clientY: event.clientY,
    button: event.button,
    buttons: event.buttons,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey
  });
  if (keepOriginalDefault) {
    control.addEventListener('click', (inner) => {
      if (inner === synthetic) inner.preventDefault();
    }, { capture: true, once: true });
  }
  return control.dispatchEvent(synthetic);
}
