import { DisposableScope } from '../core/disposable-scope';
import { closeMenuPopover } from './menu-popover';
import type { PlayerChromeContext } from './runtime-context';
import { matchesShortcut, NAVIGATION_DIRECTIONS, NAVIGATION_SHORTCUTS, type NavigationDirection, type Shortcuts } from './shortcuts';

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
  if (horizontal) return eligible.reduce((best, entry) => (entry.along < best.along ? entry : best)).index;
  const nearest = Math.min(...eligible.map(entry => entry.along));
  return eligible
    .filter(entry => entry.along <= nearest + SAME_BAND_PX)
    .reduce((best, entry) => (entry.across < best.across ? entry : best)).index;
}

const FOCUSABLE = 'button, input, [tabindex]';
const MENU_PANEL = '.theater-settings-menu, .theater-cc-menu';
const SLIDER_PANEL = '.theater-volume-panel, .theater-speed-panel';

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

/**
 * Keyboard navigation of the controls bar and its menus (W/A/S/D by default). `W` always starts it by
 * focusing the settings button; the mode lasts while focus stays inside the bar, so Escape, the bar
 * hiding, leaving theater and a rebuilt bar all end it with no timer of their own. It does not replace
 * any toggle or cycle shortcut, and keys it does not own pass through untouched.
 */
export function createNavigation(ctx: PlayerChromeContext) {
  let session: DisposableScope | null = null;

  const bar = () => ctx.queryPlayerUi<HTMLElement>('.theater-controls-wrapper');
  const focusedIn = (container: HTMLElement): HTMLElement | null => {
    const active = (container.getRootNode() as Document | ShadowRoot).activeElement;
    return active instanceof HTMLElement && container.contains(active) ? active : null;
  };

  function end(): void {
    session?.dispose();
    session = null;
  }

  function focusElement(element: HTMLElement): void {
    ctx.refs.toolbarKeyboardInteractionActive = true;
    element.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
  }

  function begin(): boolean {
    const wrapper = bar();
    if (!wrapper) return false;
    end();
    ctx.actions.showToolbar();
    const start = wrapper.querySelector<HTMLElement>('.player-settings-btn') ?? focusable(wrapper, MENU_PANEL)[0];
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

  function toTarget(from: HTMLElement, candidates: HTMLElement[], direction: NavigationDirection): HTMLElement | null {
    const index = nextFocusIndex(rectOf(from), candidates.map(rectOf), direction);
    return index < 0 ? null : candidates[index];
  }

  /** A trigger with a menu opens it the way a keyboard click does; a slider button reaches its slider. */
  function enter(element: HTMLElement): boolean {
    const container = element.parentElement;
    if (container?.classList.contains('theater-menu') && container.querySelector(':scope > button') === element) {
      element.click();
      return true;
    }
    const slider = container?.matches('.theater-volume-container, .theater-speed-container')
      ? container.querySelector<HTMLInputElement>('input[type="range"]') : null;
    if (slider && element.tagName === 'BUTTON') {
      focusElement(slider);
      return true;
    }
    return false;
  }

  function moveInBar(wrapper: HTMLElement, element: HTMLElement, direction: NavigationDirection): void {
    if (direction === 'up' && enter(element)) return;
    const target = toTarget(element, focusable(wrapper, `${MENU_PANEL}, ${SLIDER_PANEL}`), direction);
    if (target) focusElement(target);
    else if (direction === 'down') {
      // Nothing below the bar's last row: put the bar away and hand the keys back to the player.
      end();
      ctx.actions.focusTheaterPage();
      ctx.actions.hideToolbar();
    }
  }

  function moveInMenu(panel: HTMLElement, element: HTMLElement, direction: NavigationDirection): void {
    const host = panel.closest<HTMLElement>('.theater-menu');
    if (direction === 'left' || direction === 'right') {
      // On a stepper row the two arrows are the row's value: the one in that direction is the step.
      const arrows = [...(element.closest('.theater-settings-stepper-row')?.querySelectorAll<HTMLButtonElement>('.theater-stepper-btn') ?? [])]
        .sort((first, second) => first.getBoundingClientRect().left - second.getBoundingClientRect().left);
      const arrow = direction === 'left' ? arrows[0] : arrows.at(-1);
      if (arrow && !arrow.disabled) arrow.click();
      return;
    }
    const target = toTarget(element, focusable(panel), direction);
    if (target) focusElement(target);
    else if (direction === 'up' && host && closeMenuPopover(host, true)) ctx.actions.updateCaptionDock();
  }

  function moveInSlider(slider: HTMLInputElement, direction: NavigationDirection): void {
    if (direction === 'down') {
      const trigger = slider.closest('.theater-volume-container, .theater-speed-container')?.querySelector<HTMLElement>('button');
      if (trigger) focusElement(trigger);
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
    if (!session || !wrapper || !focusedIn(wrapper)) return false;
    end();
    ctx.actions.focusTheaterPage();
    ctx.actions.scheduleToolbarHide();
    return true;
  }

  return { handleKeydown, handleEscape, end, isActive: () => session !== null };
}
