import type { DisposableScope } from '../core/disposable-scope';

import { createLiveResizeBudget, type LiveResizeBudget } from './live-resize-budget';
import { systemClock, type UiClock } from './ui-clock';

/** What the separator shows: the right-docked chat's width, or nothing when there is no side chat. */
export interface ChatSeparatorState {
  shown: boolean;
  width: number;
}

/** Animation frames, injectable so a test can give every frame the duration it wants. */
export interface FrameSource {
  request(callback: (now: number) => void): number;
  cancel(id: number): void;
}

const animationFrames: FrameSource = {
  request: callback => window.requestAnimationFrame(callback),
  cancel: id => window.cancelAnimationFrame(id)
};

export interface ChatSeparatorOptions {
  scope: DisposableScope;
  label: string;
  min: number;
  max: number;
  /** Width that double-click restores. */
  defaultWidth: number;
  /** Clamps and applies a width; the next `update` reports what was applied. */
  setWidth: (width: number) => void;
  /** Times the pause after which a drag that fell back to previewing applies its width. */
  clock?: UiClock;
  frames?: FrameSource;
}

export interface ChatSeparator {
  element: HTMLElement;
  update(state: ChatSeparatorState): void;
  /** Follows the player UI's idle state; pointing at, holding or focusing the separator still shows it. */
  setChromeVisible(visible: boolean): void;
}

const STEP_PX = 10;
const LARGE_STEP_PX = 50;
/** While a drag previews, it applies its width once the pointer has rested this long, and on release. */
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

interface Drag {
  pointerId: number;
  startX: number;
  startWidth: number;
  /** Where the pointer has put the edge; the applied width follows it live, or when the drag settles. */
  preview: number;
  frame: number;
  /** The previous frame's time and whether it wrote a width, for the budget. */
  lastFrame: { at: number; wrote: boolean } | null;
  /** A width applied between frames: the next frame carries its cost. */
  wroteBetweenFrames: boolean;
  settle: number | undefined;
  scope: DisposableScope;
}

/** What the pointer drag needs from its separator. */
interface DragHost {
  element: HTMLElement;
  scope: DisposableScope;
  clock: UiClock;
  frames: FrameSource;
  budget: LiveResizeBudget;
  width(): number;
  clamp(value: number): number;
  /** Applies a width; true when it changed the applied width. */
  apply(width: number): boolean;
}

/**
 * The vertical splitter between the picture and a right-docked chat. Pointer and keyboard both
 * end in `setWidth`; keys apply at once.
 *
 * A drag resizes live, writing the width once per frame (the picture follows in the frame-batch
 * read phase). Where a width change costs more than a frame, as on YouTube, where it restyles the
 * whole page and the service's chat lays itself out again, the drag falls back to previewing: the
 * separator alone follows the pointer, translated inside the player UI, and the chat and picture
 * take the width when the pointer rests and on release, until writes fit the budget again (see
 * live-resize-budget.ts). In both modes the separator stays under the pointer.
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
  const clamp = (value: number) => Math.min(max, Math.max(min, Math.round(value)));
  const apply = (next: number) => {
    const value = clamp(next);
    if (value === width) return false;
    options.setWidth(value);
    return true;
  };
  const drag = bindPointerDrag({
    element, scope, clamp, apply,
    clock: options.clock ?? systemClock,
    frames: options.frames ?? animationFrames,
    // One budget per separator: a host that was slow on the last drag starts the next one previewing.
    budget: createLiveResizeBudget(),
    width: () => width
  });

  scope.listen(element, 'pointerenter', (event: PointerEvent) => {
    // Touch has no hover; a tap must not leave the hover look behind.
    if (event.pointerType !== 'touch') element.toggleAttribute('data-hover', true);
  });
  scope.listen(element, 'pointerleave', () => element.removeAttribute('data-hover'));

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
    setChromeVisible(visible) {
      element.toggleAttribute('data-chrome-hidden', !visible);
    },
    update(state) {
      width = clamp(state.width);
      element.setAttribute('aria-valuenow', String(width));
      drag.place();
      if (element.hidden === !state.shown) return;
      element.hidden = !state.shown;
      if (!state.shown) {
        drag.end(false);
        element.removeAttribute('data-hover');
        if (element.matches(':focus')) element.blur();
      }
    }
  };
}

/** Pointer capture, the frame loop of a drag, and its live or previewing writes. */
function bindPointerDrag(host: DragHost): { place(): void; end(commit: boolean): void } {
  const { element, scope, clock, frames, budget } = host;
  let drag: Drag | null = null;

  /** The applied edge is the host's right edge; the pointer's edge sits `width - preview` px from it. */
  const place = () => {
    const offset = drag ? host.width() - drag.preview : 0;
    element.style.transform = offset ? `translateX(${offset}px)` : '';
  };

  /** Applies the pointer's width unless the chat went away under the pointer. */
  const end = (commit: boolean) => {
    if (!drag) return;
    const current = drag;
    if (commit) host.apply(current.preview);
    drag = null;
    current.scope.dispose();
  };
  scope.add(() => end(false));

  /** Runs every frame while the pointer is held, so each interval is one frame's cost. */
  const onFrame = (current: Drag) => (now: number) => {
    current.frame = 0;
    if (drag !== current) return;
    if (current.lastFrame) budget.frame(now - current.lastFrame.at, current.lastFrame.wrote);
    let wrote = current.wroteBetweenFrames;
    current.wroteBetweenFrames = false;
    if (budget.live && host.apply(current.preview)) wrote = true;
    current.lastFrame = { at: now, wrote };
    element.dataset.dragMode = budget.live ? 'live' : 'preview';
    place();
    current.frame = frames.request(onFrame(current));
  };

  // Focus stays where it was, so the arrows keep seeking after a drag; mouse text selection is also suppressed.
  scope.listen(element, 'mousedown', (event: MouseEvent) => event.preventDefault());

  scope.listen(element, 'pointerdown', (event: PointerEvent) => {
    if (drag || !event.isPrimary || event.button !== 0 || element.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    const dragScope = scope.child();
    const width = host.width();
    const current: Drag = {
      pointerId: event.pointerId, startX: event.clientX, startWidth: width, preview: width,
      frame: 0, lastFrame: null, wroteBetweenFrames: false, settle: undefined, scope: dragScope
    };
    drag = current;
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
    element.dataset.dragMode = budget.live ? 'live' : 'preview';
    current.frame = frames.request(onFrame(current));
    dragScope.add(() => {
      frames.cancel(current.frame);
      clock.clearTimeout(current.settle);
      overlay.remove();
      element.removeAttribute('data-dragging');
      delete element.dataset.dragMode;
      element.style.removeProperty('transform');
    });
  });

  scope.listen(element, 'pointermove', (event: PointerEvent) => {
    const current = drag;
    if (!current || event.pointerId !== current.pointerId) return;
    event.preventDefault();
    current.preview = host.clamp(current.startWidth + current.startX - event.clientX);
    // Live, the next frame applies the width and this timer finds nothing to do.
    clock.clearTimeout(current.settle);
    current.settle = clock.setTimeout(() => {
      current.settle = undefined;
      if (drag === current && host.apply(current.preview)) current.wroteBetweenFrames = true;
    }, CHAT_SEPARATOR_SETTLE_MS);
  });

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    scope.listen(element, type, (event: PointerEvent) => {
      if (drag && event.pointerId === drag.pointerId) end(true);
    });
  }

  return { place, end };
}
