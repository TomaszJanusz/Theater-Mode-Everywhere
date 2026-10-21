import type { DisposableScope } from '../core/disposable-scope';

import { bindSliderPopover } from './menu-popover';
import type { UiClock } from './ui-clock';

/** What a control supplies; structure, marker, fill and tooltip are the same for every slider. */
export interface VerticalSliderOptions {
  /** The control's container; the panel is appended to it and bound as its popover. */
  container: HTMLElement;
  scope: DisposableScope;
  label: string;
  /** Identity hooks for the panel and the input; styling is shared. */
  panelClass: string;
  sliderClass: string;
  min: number;
  max: number;
  step: number;
  /** Input value that gets the marker; hidden unless it lies inside the range. */
  markerValue: number;
  /** Drives the pointer-focus hide timer; tests inject a fake. */
  clock?: UiClock;
}

/** One rendering of the slider: the input value, its label and whether it is boosted. */
export interface VerticalSliderView {
  value: number;
  text: string;
  boosted?: boolean;
}

export interface VerticalSlider {
  slider: HTMLInputElement;
  panel: HTMLElement;
  /** Re-range the track (a changed ceiling); the marker and fill follow. */
  setMax(max: number): void;
  render(view: VerticalSliderView): void;
}

const THUMB = 12;

/**
 * The wrapper is wider than the 6px track so a press beside it still counts. A press on the
 * input itself is native; one in the padding jumps the thumb to the pointer and keeps dragging,
 * through the same `input` events, so the input stays the one source of value, focus and ARIA.
 */
function bindPaddingDrag(wrapper: HTMLElement, slider: HTMLInputElement, scope: DisposableScope): void {
  const setFromPointer = (event: PointerEvent) => {
    // The input is rotated, so its bounding box is the vertical track the thumb travels.
    const track = slider.getBoundingClientRect();
    const span = track.height - THUMB;
    const along = Math.min(1, Math.max(0, (track.bottom - THUMB / 2 - event.clientY) / span));
    const min = Number(slider.min);
    const step = Number(slider.step);
    const raw = min + along * (Number(slider.max) - min);
    const before = slider.value;
    // Assigning the value lets the browser clamp it to the range.
    slider.value = String(Math.round((Math.round((raw - min) / step) * step + min) * 1e4) / 1e4);
    if (slider.value !== before) slider.dispatchEvent(new Event('input', { bubbles: true }));
  };
  let dragging: number | null = null;
  scope.listen(wrapper, 'pointerdown', (event: PointerEvent) => {
    if (event.target === slider || event.button !== 0 || slider.disabled) return;
    event.preventDefault();
    slider.focus();
    dragging = event.pointerId;
    wrapper.setPointerCapture(event.pointerId);
    setFromPointer(event);
  });
  scope.listen(wrapper, 'pointermove', (event: PointerEvent) => {
    if (event.pointerId === dragging) setFromPointer(event);
  });
  const end = (event: PointerEvent) => {
    if (event.pointerId !== dragging) return;
    dragging = null;
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  };
  scope.listen(wrapper, 'pointerup', end);
  scope.listen(wrapper, 'pointercancel', end);
}

/**
 * Track fill and marker both sit at a fraction of the input range, so the 1x and 100% marks stay
 * on the thumb's path whatever the range is. shadow.css turns the fractions into geometry.
 */
export function createVerticalSlider(options: VerticalSliderOptions): VerticalSlider {
  const { min, markerValue } = options;
  let { max } = options;

  const panel = document.createElement('div');
  panel.className = options.panelClass;
  const tooltip = document.createElement('div');
  tooltip.className = 'theater-slider-tooltip';
  const wrapper = document.createElement('div');
  wrapper.className = 'theater-vertical-slider-wrapper';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = `${options.sliderClass} theater-vertical-slider`;
  slider.setAttribute('aria-label', options.label);
  slider.setAttribute('aria-orientation', 'vertical');
  slider.min = String(min);
  slider.step = String(options.step);
  const marker = document.createElement('div');
  marker.className = 'theater-slider-marker';
  wrapper.append(slider, marker);
  panel.append(tooltip, wrapper);
  options.container.append(panel);
  bindSliderPopover(options.container, panel, options.scope, options.clock);

  bindPaddingDrag(wrapper, slider, options.scope);

  const fraction = (value: number) => (value - min) / (max - min);
  let last: VerticalSliderView | null = null;
  const paint = () => {
    marker.hidden = !(markerValue > min && markerValue < max);
    marker.style.setProperty('--slider-position', String(fraction(markerValue)));
    slider.max = String(max);
    if (!last) return;
    slider.value = String(last.value);
    slider.style.setProperty('--slider-position', String(Math.min(1, Math.max(0, fraction(last.value)))));
    slider.classList.toggle('boosted', Boolean(last.boosted));
    tooltip.classList.toggle('boosted', Boolean(last.boosted));
    tooltip.textContent = last.text;
    slider.setAttribute('aria-valuetext', last.text);
  };
  paint();

  return {
    slider,
    panel,
    setMax(next) {
      if (next === max) return;
      max = next;
      paint();
    },
    render(view) {
      last = view;
      paint();
    }
  };
}
