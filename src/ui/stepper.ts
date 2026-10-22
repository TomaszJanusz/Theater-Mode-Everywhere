import type { DisposableScope } from '../core/disposable-scope';

import { isElementMotionReduced } from './spinner-exit';
import { createSvgIcon } from './svg-icon';

export interface StepperState {
  /** The current option's label. */
  value: string;
  /** Zero-based position of the current option. */
  index: number;
  /** How many options exist, one segment each. */
  count: number;
}

export interface StepperOptions {
  scope: DisposableScope;
  /** Accessible names for the two arrows, which name the setting they change. */
  previousLabel: string;
  nextLabel: string;
  /** Called with -1 or 1 for an arrow that can move; the ends are disabled, so it never wraps. */
  onStep: (direction: 1 | -1) => void;
}

const CHEVRON = (points: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${points}"/></svg>`;

const SLIDE_PX = 8;
const BUMP_PX = 4;
const SLIDE_MS = 150;
const BUMP_MS = 140;
const EASE_OUT = 'cubic-bezier(0.25, 1, 0.5, 1)';

/**
 * Arrows around the current value, with one segment per option under it. Shared by every
 * discrete multi-option setting; the arrows are real buttons, so a pointer and the keyboard
 * go through the same click handler. Direction is mirrored by the surrounding `dir`.
 *
 * An arrow at either end is `aria-disabled` rather than `disabled`: it keeps focus, so holding a key
 * or pressing again never drops the user's place, and the blocked press can answer with a small nudge.
 * Motion is transform/opacity only (the segment thumb in CSS, the label and nudges through WAAPI), never
 * delays the value change, restarts from the latest step, and is skipped under reduced motion.
 */
export function createStepper(options: StepperOptions): {
  element: HTMLElement;
  update: (state: StepperState) => void;
  /** Nudge in the direction a press could not go; called for a blocked step. */
  bump: (direction: 1 | -1) => void;
} {
  const element = document.createElement('span');
  element.className = 'theater-stepper';

  const arrow = (direction: 1 | -1, label: string) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theater-stepper-btn';
    button.dataset.direction = String(direction);
    button.setAttribute('aria-label', label);
    button.append(createSvgIcon(CHEVRON(direction < 0 ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6')));
    options.scope.listen(button, 'click', (event: MouseEvent) => {
      event.stopPropagation();
      if (button.getAttribute('aria-disabled') === 'true') bump(direction);
      else options.onStep(direction);
    });
    return button;
  };
  const previous = arrow(-1, options.previousLabel);
  const next = arrow(1, options.nextLabel);
  const value = document.createElement('span');
  value.className = 'theater-stepper-value';
  value.setAttribute('aria-live', 'polite');
  const segments = document.createElement('span');
  segments.className = 'theater-stepper-segments';
  segments.setAttribute('aria-hidden', 'true');
  const thumb = document.createElement('span');
  thumb.className = 'theater-stepper-thumb';
  segments.append(thumb);
  element.append(previous, value, next, segments);

  let animations: Animation[] = [];
  options.scope.add(() => cancelMotion());
  function cancelMotion(): void {
    for (const animation of animations) animation.cancel();
    animations = [];
  }
  /** Screen direction of a logical step: the arrows swap sides in a right-to-left layout. */
  const screenSign = () => (getComputedStyle(element).direction === 'rtl' ? -1 : 1);
  function play(target: HTMLElement, keyframes: Keyframe[], duration: number): void {
    const animation = target.animate(keyframes, { duration, easing: EASE_OUT });
    animations.push(animation);
    const forget = () => { animations = animations.filter(entry => entry !== animation); };
    animation.addEventListener('finish', forget);
    animation.addEventListener('cancel', forget);
  }
  const moves = () => !isElementMotionReduced(element);

  function bump(direction: 1 | -1): void {
    if (!moves()) return;
    const offset = direction * screenSign() * BUMP_PX;
    cancelMotion();
    for (const target of [value, (direction < 0 ? previous : next).firstElementChild as HTMLElement]) {
      play(target, [{ translate: '0 0' }, { translate: `${offset}px 0`, offset: 0.4 }, { translate: '0 0' }], BUMP_MS);
    }
  }

  let shown: StepperState | undefined;
  return {
    element,
    bump,
    update({ value: text, index, count }) {
      const changed = shown && shown.index !== index;
      const step = shown ? Math.sign(index - shown.index) : 0;
      shown = { value: text, index, count };
      value.textContent = text;
      value.title = text;
      while (segments.childElementCount - 1 > count) segments.children[1].remove();
      while (segments.childElementCount - 1 < count) {
        const segment = document.createElement('span');
        segment.className = 'theater-stepper-segment';
        segments.append(segment);
      }
      [...segments.children].slice(1).forEach((segment, position) => {
        (segment as HTMLElement).dataset.current = String(position === index);
        (segment as HTMLElement).dataset.reached = String(position <= index);
      });
      element.style.setProperty('--theater-stepper-count', String(count));
      element.style.setProperty('--theater-stepper-index', String(index));
      previous.setAttribute('aria-disabled', String(index <= 0));
      next.setAttribute('aria-disabled', String(index >= count - 1));
      if (changed && moves()) {
        // The new label arrives from the side of the arrow that was pressed; an older slide yields to it.
        cancelMotion();
        play(value, [
          { opacity: 0.35, translate: `${step * screenSign() * SLIDE_PX}px 0` },
          { opacity: 1, translate: '0 0' }
        ], SLIDE_MS);
      }
    }
  };
}
