import { createStepper } from '../src/ui/stepper';

import { renderPlayerBar } from './player-stage';

export interface StepperArgs {
  count: number;
  index: number;
  /** The setting cannot change right now, as AutoTheater on a page without support. */
  disabled?: boolean;
}

/** What the stepper reported to its owner, and the position the owner applied, as the runtime would. */
export interface StepperRun {
  steps: number[];
  index: number;
  update(count: number, index: number, disabled?: boolean): void;
}

let current: StepperRun | undefined;
export const run = (): StepperRun => current!;

export const stepperRoot = () => document.getElementById('theater-everywhere-ui')!.shadowRoot!;
export const stepperRow = () => stepperRoot().querySelector<HTMLElement>('.theater-settings-stepper-row')!;
export const arrow = (direction: 1 | -1) =>
  stepperRoot().querySelector<HTMLButtonElement>(`.theater-stepper-btn[data-direction="${direction}"]`)!;
export const segments = () => [...stepperRoot().querySelectorAll<HTMLElement>('.theater-stepper-segment')];
/** The whole segment bar, thumb included; absent while the setting is unavailable. */
export const segmentsBar = () => stepperRoot().querySelector<HTMLElement>('.theater-stepper-segments');
export const thumb = () => stepperRoot().querySelector<HTMLElement>('.theater-stepper-thumb')!;
export const arrowDisabled = (direction: 1 | -1) => arrow(direction).getAttribute('aria-disabled') === 'true';
export const stepperValue = () => stepperRoot().querySelector<HTMLElement>('.theater-stepper-value')!;

export function renderStepper(args: StepperArgs): HTMLElement {
  return renderPlayerBar(scope => {
    const row = document.createElement('div');
    row.className = 'theater-settings-row theater-settings-stepper-row';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Setting');
    const label = document.createElement('span');
    label.className = 'theater-settings-label';
    label.textContent = 'Setting';
    let count = args.count;
    let disabled = args.disabled ?? false;
    const state = { steps: [] as number[], index: args.index };
    const control = createStepper({
      scope,
      previousLabel: 'Setting: previous option',
      nextLabel: 'Setting: next option',
      onStep: direction => {
        state.steps.push(direction);
        state.index = Math.min(count - 1, Math.max(0, state.index + direction));
        paint();
      }
    });
    const paint = () => control.update({ value: disabled ? 'Unavailable' : `Option ${state.index + 1}`, index: state.index, count, disabled });
    paint();
    current = {
      ...state,
      get steps() { return state.steps; },
      get index() { return state.index; },
      update(nextCount, nextIndex, nextDisabled = false) { count = nextCount; state.index = nextIndex; disabled = nextDisabled; paint(); }
    } as StepperRun;
    row.append(label, control.element);
    return [row];
  });
}
