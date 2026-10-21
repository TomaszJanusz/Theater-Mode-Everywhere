import type { DisposableScope } from '../core/disposable-scope';

import { bindSliderPopover } from './menu-popover';

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
  bindSliderPopover(options.container, panel, options.scope);

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
