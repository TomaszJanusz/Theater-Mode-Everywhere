import type { DisposableScope } from '../core/disposable-scope';

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

/**
 * Arrows around the current value, with one segment per option under it. Shared by every
 * discrete multi-option setting; the arrows are real buttons, so a pointer and the keyboard
 * go through the same click handler. Direction is mirrored by the surrounding `dir`.
 */
export function createStepper(options: StepperOptions): { element: HTMLElement; update: (state: StepperState) => void } {
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
      if (!button.disabled) options.onStep(direction);
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
  element.append(previous, value, next, segments);

  /** A disabled button cannot keep focus: enable first, then hand its focus to the arrow that can still move. */
  const setDisabled = (previousDisabled: boolean, nextDisabled: boolean) => {
    const active = (element.getRootNode() as Document | ShadowRoot).activeElement;
    previous.disabled = previousDisabled;
    next.disabled = nextDisabled;
    if (active === previous && previousDisabled && !nextDisabled) next.focus({ preventScroll: true });
    else if (active === next && nextDisabled && !previousDisabled) previous.focus({ preventScroll: true });
  };

  return {
    element,
    update({ value: text, index, count }) {
      value.textContent = text;
      value.title = text;
      while (segments.childElementCount > count) segments.lastElementChild!.remove();
      while (segments.childElementCount < count) {
        const segment = document.createElement('span');
        segment.className = 'theater-stepper-segment';
        segments.append(segment);
      }
      [...segments.children].forEach((segment, position) => {
        (segment as HTMLElement).dataset.current = String(position === index);
        (segment as HTMLElement).dataset.reached = String(position <= index);
      });
      element.style.setProperty('--theater-stepper-count', String(count));
      setDisabled(index <= 0, index >= count - 1);
    }
  };
}
