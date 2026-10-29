import type { DisposableScope } from '../core/disposable-scope';

/** What the separator shows: the right-docked chat's width, or nothing when there is no side chat. */
export interface ChatSeparatorState {
  shown: boolean;
  width: number;
}

export interface ChatSeparatorOptions {
  scope: DisposableScope;
  label: string;
  min: number;
  max: number;
  /** Width that double-click restores. */
  defaultWidth: number;
  /** Clamps and applies a width; the next `update` reports what was applied. */
  setWidth: (width: number) => void;
}

export interface ChatSeparator {
  element: HTMLElement;
  update(state: ChatSeparatorState): void;
}

const STEP_PX = 10;
const LARGE_STEP_PX = 50;

/**
 * The vertical splitter between the picture and a right-docked chat. Pointer and keyboard both
 * end in `setWidth`; a drag applies at most one width per animation frame, so the chat geometry
 * and the picture layout it triggers are written and read once per frame.
 *
 * Chat always sits on the physical right, in right-to-left interfaces too, so the arrows move the
 * splitter the way they point: Left widens the chat and Right narrows it. Home and End give the
 * chat its smallest and largest width, as the separator role's value is the chat width.
 */
export function createChatSeparator(options: ChatSeparatorOptions): ChatSeparator {
  const { scope, min, max } = options;
  const element = document.createElement('div');
  element.className = 'theater-chat-separator';
  element.setAttribute('role', 'separator');
  element.setAttribute('aria-orientation', 'vertical');
  element.setAttribute('aria-label', options.label);
  element.setAttribute('aria-valuemin', String(min));
  element.setAttribute('aria-valuemax', String(max));
  element.tabIndex = 0;
  element.hidden = true;
  const grip = document.createElement('span');
  grip.className = 'theater-chat-separator-grip';
  grip.setAttribute('aria-hidden', 'true');
  element.append(grip);

  let width = options.defaultWidth;
  let drag: { pointerId: number; startX: number; startWidth: number; pending: number | null; frame: number; scope: DisposableScope } | null = null;

  const clamp = (value: number) => Math.min(max, Math.max(min, Math.round(value)));
  const apply = (next: number) => {
    const value = clamp(next);
    if (value !== width) options.setWidth(value);
  };

  const flush = () => {
    if (!drag || drag.pending === null) return;
    const next = drag.pending;
    drag.pending = null;
    apply(next);
  };

  /** Applies the last move unless the chat went away under the pointer. */
  const endDrag = (commit = true) => {
    if (!drag) return;
    const current = drag;
    if (commit) flush();
    drag = null;
    current.scope.dispose();
  };

  scope.add(() => endDrag(false));

  scope.listen(element, 'pointerenter', (event: PointerEvent) => {
    // Touch has no hover; a tap must not leave the hover look behind.
    if (event.pointerType !== 'touch') element.toggleAttribute('data-hover', true);
  });
  scope.listen(element, 'pointerleave', () => element.removeAttribute('data-hover'));

  // Focus stays where it was, so the arrows keep seeking after a drag; mouse text selection is also suppressed.
  scope.listen(element, 'mousedown', (event: MouseEvent) => event.preventDefault());

  scope.listen(element, 'pointerdown', (event: PointerEvent) => {
    if (drag || !event.isPrimary || event.button !== 0 || element.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    const dragScope = scope.child();
    drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, pending: null, frame: 0, scope: dragScope };
    try {
      element.setPointerCapture(event.pointerId);
      dragScope.add(() => {
        if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      });
    } catch { /* The overlay below still keeps the moves away from the chat frame. */ }
    // Capture keeps moves on the separator; the overlay also covers the chat frame, whose document
    // would otherwise receive the moves where capture does not cross frames.
    const overlay = document.createElement('div');
    overlay.className = 'theater-chat-separator-overlay';
    element.append(overlay);
    element.toggleAttribute('data-dragging', true);
    dragScope.add(() => {
      overlay.remove();
      element.removeAttribute('data-dragging');
    });
  });

  scope.listen(element, 'pointermove', (event: PointerEvent) => {
    const current = drag;
    if (!current || event.pointerId !== current.pointerId) return;
    event.preventDefault();
    current.pending = current.startWidth + current.startX - event.clientX;
    if (current.frame) return;
    current.frame = current.scope.raf(() => {
      current.frame = 0;
      if (drag === current) flush();
    });
  });

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    scope.listen(element, type, (event: PointerEvent) => {
      if (drag && event.pointerId === drag.pointerId) endDrag();
    });
  }

  scope.listen(element, 'dblclick', (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    apply(options.defaultWidth);
  });

  scope.listen(element, 'keydown', (event: KeyboardEvent) => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? LARGE_STEP_PX : STEP_PX;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft': next = width + step; break;
      case 'ArrowRight': next = width - step; break;
      case 'Home': next = min; break;
      case 'End': next = max; break;
      default: return;
    }
    // The page's own shortcuts (seeking on YouTube) must not also take the key.
    event.preventDefault();
    event.stopPropagation();
    apply(next);
  });

  return {
    element,
    update(state) {
      width = clamp(state.width);
      element.setAttribute('aria-valuenow', String(width));
      if (element.hidden === !state.shown) return;
      element.hidden = !state.shown;
      if (!state.shown) {
        endDrag(false);
        element.removeAttribute('data-hover');
        if (element.matches(':focus')) element.blur();
      }
    }
  };
}
