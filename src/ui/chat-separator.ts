import type { DisposableScope } from '../core/disposable-scope';

import { systemClock, type UiClock } from './ui-clock';

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
  /** Times the pause after which a drag applies its width. */
  clock?: UiClock;
}

export interface ChatSeparator {
  element: HTMLElement;
  update(state: ChatSeparatorState): void;
}

const STEP_PX = 10;
const LARGE_STEP_PX = 50;
/** A drag applies its width once the pointer has rested this long, and on release. */
export const CHAT_SEPARATOR_SETTLE_MS = 120;

/**
 * The width a separator key asks for, or null for a key it leaves alone. Chat always sits on the
 * physical right, in right-to-left interfaces too, so the arrows move the splitter the way they
 * point: Left widens the chat and Right narrows it. Home and End give the chat its smallest and
 * largest width, as the separator role's value is the chat width.
 */
export function keyboardChatWidth(key: string, large: boolean, width: number, range: { min: number; max: number }): number | null {
  const step = large ? LARGE_STEP_PX : STEP_PX;
  switch (key) {
    case 'ArrowLeft': return width + step;
    case 'ArrowRight': return width - step;
    case 'Home': return range.min;
    case 'End': return range.max;
    default: return null;
  }
}

/**
 * The vertical splitter between the picture and a right-docked chat. Pointer and keyboard both
 * end in `setWidth`.
 *
 * A width change restyles the whole host page (the chat geometry lives on its root) and makes the
 * service's chat lay itself out again; on YouTube that is far more than a frame. So while the
 * pointer moves, only the separator follows it, translated inside the player UI, which restyles
 * nothing else; the chat and the picture take the width when the pointer rests and on release.
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

  const clock = options.clock ?? systemClock;
  let width = options.defaultWidth;
  let drag: {
    pointerId: number; startX: number; startWidth: number;
    /** Where the pointer has put the edge; `width` catches up when the drag settles. */
    preview: number;
    frame: number; settle: number | undefined; scope: DisposableScope;
  } | null = null;

  const clamp = (value: number) => Math.min(max, Math.max(min, Math.round(value)));
  const apply = (next: number) => {
    const value = clamp(next);
    if (value !== width) options.setWidth(value);
  };

  /** The applied edge is the host's right edge; the preview sits `width - preview` px from it. */
  const place = () => {
    const offset = drag ? width - drag.preview : 0;
    element.style.transform = offset ? `translateX(${offset}px)` : '';
  };

  /** Applies the previewed width unless the chat went away under the pointer. */
  const endDrag = (commit = true) => {
    if (!drag) return;
    const current = drag;
    if (commit) apply(current.preview);
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
    drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, preview: width, frame: 0, settle: undefined, scope: dragScope };
    const current = drag;
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
      clock.clearTimeout(current.settle);
      overlay.remove();
      element.removeAttribute('data-dragging');
      element.style.removeProperty('transform');
    });
  });

  scope.listen(element, 'pointermove', (event: PointerEvent) => {
    const current = drag;
    if (!current || event.pointerId !== current.pointerId) return;
    event.preventDefault();
    current.preview = clamp(current.startWidth + current.startX - event.clientX);
    clock.clearTimeout(current.settle);
    current.settle = clock.setTimeout(() => {
      current.settle = undefined;
      if (drag === current) apply(current.preview);
    }, CHAT_SEPARATOR_SETTLE_MS);
    if (current.frame) return;
    current.frame = current.scope.raf(() => {
      current.frame = 0;
      if (drag === current) place();
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
    const next = keyboardChatWidth(event.key, event.shiftKey, width, options);
    if (next === null) return;
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
      if (drag) place();
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
