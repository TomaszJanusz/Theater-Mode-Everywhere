import { DisposableScope } from '../core/disposable-scope';

import { closeMenuPopover } from './menu-popover';
import type { PlayerChromeContext } from './runtime-context';
import { matchesShortcut, NAVIGATION_DIRECTIONS, NAVIGATION_SHORTCUTS, type NavigationDirection, type Shortcuts } from './shortcuts';
import { isElementMotionReduced } from './spinner-exit';

export interface FocusRect { left: number; top: number; right: number; bottom: number }

/** Centres closer than this on the axis of travel are the same place, not a step. */
const SAME_PLACE_PX = 4;
/** Candidates whose distance differs by less than this count as one row (or column). */
const SAME_BAND_PX = 6;

const centreX = (rect: FocusRect) => (rect.left + rect.right) / 2;
const centreY = (rect: FocusRect) => (rect.top + rect.bottom) / 2;

/**
 * Where focus goes from `from` in a direction, as an index into `candidates`, or -1 when nothing lies that way.
 * Left and right stay on the current row. Up and down take the nearest row in that direction and, within it,
 * the item closest in line with where focus is. Directions are physical (screen) directions, so a right-to-left
 * layout needs no special case.
 */
export function nextFocusIndex(from: FocusRect, candidates: readonly FocusRect[], direction: NavigationDirection): number {
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'right' || direction === 'down' ? 1 : -1;
  const eligible: Array<{ index: number; along: number; across: number }> = [];
  candidates.forEach((candidate, index) => {
    const along = horizontal ? centreX(candidate) - centreX(from) : centreY(candidate) - centreY(from);
    const across = horizontal ? centreY(candidate) - centreY(from) : centreX(candidate) - centreX(from);
    if (along * sign <= SAME_PLACE_PX) return;
    if (horizontal) {
      const height = Math.min(from.bottom - from.top, candidate.bottom - candidate.top);
      if (Math.abs(across) > height / 2) return;
    }
    eligible.push({ index, along: Math.abs(along), across: Math.abs(across) });
  });
  if (!eligible.length) return -1;
  const nearest = Math.min(...eligible.map(entry => entry.along));
  // Sideways the nearest wins; vertically the nearest row does, and within it the item most in line.
  const pool = horizontal ? eligible : eligible.filter(entry => entry.along <= nearest + SAME_BAND_PX);
  const key = horizontal ? 'along' : 'across';
  return pool.reduce((best, entry) => (entry[key] < best[key] ? entry : best), pool[0]).index;
}

/** On a stepper row the two arrows are the row's value: the one on that side of the row is the step. */
function stepperArrow(element: HTMLElement, direction: NavigationDirection): HTMLButtonElement | undefined {
  const arrows = [...(element.closest('.theater-settings-stepper-row')?.querySelectorAll<HTMLButtonElement>('.theater-stepper-btn') ?? [])]
    .sort((first, second) => first.getBoundingClientRect().left - second.getBoundingClientRect().left);
  return direction === 'left' ? arrows[0] : arrows.at(-1);
}

function toTarget(from: HTMLElement, candidates: HTMLElement[], direction: NavigationDirection): HTMLElement | null {
  const index = nextFocusIndex(rectOf(from), candidates.map(rectOf), direction);
  return index < 0 ? null : candidates[index];
}

/** The bar's own curve and a short run: the arriving element settles in from the side focus came from. */
const SETTLE_MS = 130;
const SETTLE_PX = 4;
const SETTLE_EASE = 'cubic-bezier(0.25, 1, 0.5, 1)';
const SETTLE_OFFSETS: Record<NavigationDirection, [number, number]> = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] };

const FOCUSABLE = 'button, input, [tabindex]';
const MENU_PANEL = '.theater-settings-menu, .theater-cc-menu';
const SLIDER_PANEL = '.theater-volume-panel, .theater-speed-panel';
/** Bar controls the keys pass over: panels are entered through their trigger, and the time readouts and the
 *  scrubber stay with Tab and their own keys. */
const OFF_BAR = `${MENU_PANEL}, ${SLIDER_PANEL}, .theater-time-display, .theater-scrubber-container`;

function rectOf(element: Element): FocusRect {
  const { left, top, right, bottom } = element.getBoundingClientRect();
  return { left, top, right, bottom };
}

function focusable(root: ParentNode, exclude?: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element => {
    if (element.tabIndex < 0 && !element.matches('button, input')) return false;
    if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) {
      if (element.disabled || element.type === 'hidden') return false;
    }
    if (element.closest('[hidden], [inert]') || element.getClientRects().length === 0) return false;
    return !(exclude && element.closest(exclude));
  });
}

/** Focus moves without scrolling the page, so a menu whose list scrolls brings the focused row into view itself.
 *  `nearest` leaves every ancestor that already shows the row, the page included, where it is. */
function revealInMenu(element: HTMLElement): void {
  if (element.closest('.theater-settings-body, .theater-cc-menu-list')) element.scrollIntoView({ block: 'nearest' });
}

/**
 * Keyboard navigation of the controls bar and its menus (W/A/S/D by default). `W` always starts it by
 * focusing the settings button; the mode lasts while focus stays inside the bar, so Escape, the bar
 * hiding, leaving theater and a rebuilt bar all end it with no timer of their own. It does not replace
 * any toggle or cycle shortcut, and keys it does not own pass through untouched.
 */
export function createNavigation(ctx: PlayerChromeContext) {
  let session: DisposableScope | null = null;
  let settling: Animation | null = null;

  const bar = () => ctx.queryPlayerUi<HTMLElement>('.theater-controls-wrapper');
  const focusedIn = (container: HTMLElement): HTMLElement | null => {
    const active = (container.getRootNode() as Document | ShadowRoot).activeElement;
    return active instanceof HTMLElement && container.contains(active) ? active : null;
  };

  function end(): void {
    settling?.cancel();
    settling = null;
    session?.dispose();
    session = null;
  }

  /** Focus moves at once; the settle is only paint (transform/opacity), restarts on a quicker move and yields to reduced motion. */
  function focusElement(element: HTMLElement, direction?: NavigationDirection): void {
    ctx.refs.toolbarKeyboardInteractionActive = true;
    element.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
    revealInMenu(element);
    settling?.cancel();
    if (isElementMotionReduced(element)) return;
    const [x, y] = direction ? SETTLE_OFFSETS[direction] : [0, 0];
    const animation = element.animate([
      { translate: `${x * SETTLE_PX}px ${y * SETTLE_PX}px`, scale: direction ? 1 : 0.94, opacity: 0.6 },
      { translate: '0 0', scale: 1, opacity: 1 }
    ], { duration: SETTLE_MS, easing: SETTLE_EASE });
    settling = animation;
    const done = () => { if (settling === animation) settling = null; };
    animation.addEventListener('finish', done);
    animation.addEventListener('cancel', done);
  }

  /** A host blur does not reliably reach focus inside the shadow root, so blur the control itself. */
  function leaveBar(element: HTMLElement): void {
    end();
    element.blur();
    ctx.actions.focusTheaterPage();
  }

  function begin(): boolean {
    const wrapper = bar();
    if (!wrapper) return false;
    end();
    ctx.actions.showToolbar();
    const start = wrapper.querySelector<HTMLElement>('.player-settings-btn') ?? focusable(wrapper, OFF_BAR)[0];
    if (!start) return false;
    focusElement(start);
    if (focusedIn(wrapper) !== start) return false;
    // Ends with focus: tabbing or clicking away, the bar hiding or a rebuild all drop focus out of the bar.
    session = new DisposableScope();
    session.listen(wrapper, 'focusout', (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node && wrapper.contains(event.relatedTarget))) end();
    });
    return true;
  }

  /** A trigger with a menu opens it as a keyboard click does and enters at its bottom row, the one nearest the
   *  bar (menus open upward); a slider button reaches its slider. */
  function enter(element: HTMLElement): boolean {
    const container = element.parentElement;
    if (container?.classList.contains('theater-menu') && container.querySelector(':scope > button') === element) {
      element.click();
      // The trigger precedes its panel, so the last control in the host is the panel's bottom row.
      focusElement(focusable(container).at(-1) ?? element, 'up');
      return true;
    }
    const slider = container?.matches('.theater-volume-container, .theater-speed-container')
      ? container.querySelector<HTMLInputElement>('input[type="range"]') : null;
    if (slider && element.tagName === 'BUTTON') {
      focusElement(slider, 'up');
      return true;
    }
    return false;
  }

  function moveInBar(wrapper: HTMLElement, element: HTMLElement, direction: NavigationDirection): void {
    if (direction === 'up' && enter(element)) return;
    const target = toTarget(element, focusable(wrapper, OFF_BAR), direction);
    if (target) focusElement(target, direction);
    else if (direction === 'down') {
      // Nothing below the bar's last row: put the bar away and hand the keys back to the player.
      leaveBar(element);
      ctx.actions.hideToolbar();
    }
  }

  function moveInMenu(panel: HTMLElement, element: HTMLElement, direction: NavigationDirection): void {
    const host = panel.closest<HTMLElement>('.theater-menu');
    if (direction === 'left' || direction === 'right') {
      // A blocked end is still a press: the stepper answers with its nudge rather than staying silent.
      stepperArrow(element, direction)?.click();
      return;
    }
    const target = toTarget(element, focusable(panel), direction);
    if (target) focusElement(target, direction);
    // Past the bottom row is back toward the bar: close the menu onto its trigger. The top row is a dead end.
    else if (direction === 'down' && host && closeMenuPopover(host, true)) ctx.actions.updateCaptionDock();
  }

  function moveInSlider(slider: HTMLInputElement, direction: NavigationDirection): void {
    if (direction === 'down') {
      const trigger = slider.closest('.theater-volume-container, .theater-speed-container')?.querySelector<HTMLElement>('button');
      if (trigger) focusElement(trigger, 'down');
    } else if (direction !== 'up') {
      if (direction === 'left') slider.stepDown();
      else slider.stepUp();
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /** Returns whether the key was consumed; the caller then stops it from reaching the page. */
  function handleKeydown(event: KeyboardEvent, shortcuts: Shortcuts): boolean {
    const action = NAVIGATION_SHORTCUTS.find(name => matchesShortcut(event, shortcuts[name]));
    if (!action) return false;
    const direction = NAVIGATION_DIRECTIONS[action];
    const wrapper = bar();
    const element = wrapper && session ? focusedIn(wrapper) : null;
    if (!wrapper || !element) {
      end();
      // Only Up starts the mode. The other keys belong to the page until it is running.
      return direction === 'up' && begin();
    }
    const panel = element.closest<HTMLElement>(MENU_PANEL);
    if (panel) moveInMenu(panel, element, direction);
    else if (element instanceof HTMLInputElement && element.closest(SLIDER_PANEL)) moveInSlider(element, direction);
    else moveInBar(wrapper, element, direction);
    return true;
  }

  /** Escape ends the mode from the bar (a menu's Escape closes the menu first); returns whether it did. */
  function handleEscape(): boolean {
    const wrapper = bar();
    const element = session && wrapper ? focusedIn(wrapper) : null;
    if (!element) return false;
    leaveBar(element);
    ctx.actions.scheduleToolbarHide();
    return true;
  }

  return { handleKeydown, handleEscape, end, isActive: () => session !== null };
}
