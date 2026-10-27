import type { DisposableScope } from '../core/disposable-scope';

import { armPictureDismissOnLeave } from './picture-dismiss';
import { createVerticalSlider } from './vertical-slider';

export interface SpeedControlOptions {
  video: { playbackRate: number };
  scope: DisposableScope;
  /** One string names the button, the slider and its value text. */
  label: string;
  updateCaptionDock(): void;
  blurMouseToggle(event: MouseEvent, button: HTMLElement): void;
}

export interface SpeedControl {
  container: HTMLElement;
  button: HTMLButtonElement;
  slider: HTMLInputElement;
  /** Re-read the rate after it changed from outside the control. */
  sync(): void;
}

const SPEED_LEVELS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

function closestSpeedIndex(rate: number): number {
  let closest = 3; // default to 1.0
  let minDiff = Infinity;
  SPEED_LEVELS.forEach((level, index) => {
    const diff = Math.abs(level - rate);
    if (diff < minDiff) {
      minDiff = diff;
      closest = index;
    }
  });
  return closest;
}

export const formatRate = (rate: number) => `${rate.toFixed(2).replace(/\.00$|\.0$/, '')}x`;

/**
 * The next level of the speed menu past `rate` in `direction`. A rate the host set between or beyond the
 * levels moves to the nearest level on that side, and one already past the last level stays where it is.
 */
export function stepPlaybackRate(rate: number, direction: 1 | -1): number {
  const next = direction > 0 ? SPEED_LEVELS.find(level => level > rate + 1e-6)
    : SPEED_LEVELS.findLast(level => level < rate - 1e-6);
  return next ?? rate;
}

export function createSpeedControl(options: SpeedControlOptions): SpeedControl {
  const { video, scope, label } = options;
  const container = document.createElement('div');
  container.className = 'theater-speed-container theater-popover';
  container.addEventListener('pointerenter', options.updateCaptionDock);
  container.addEventListener('pointerleave', (event) => {
    armPictureDismissOnLeave(event, container);
    options.updateCaptionDock();
  });

  const button = document.createElement('button');
  button.className = 'theater-control-btn speed-btn';
  button.setAttribute('aria-label', label);
  const buttonLabel = document.createElement('span');
  buttonLabel.className = 'speed-label';
  button.appendChild(buttonLabel);

  container.append(button);
  const { slider, render } = createVerticalSlider({
    container,
    scope,
    label,
    panelClass: 'theater-speed-panel',
    sliderClass: 'theater-speed-slider',
    min: 0,
    max: SPEED_LEVELS.length - 1,
    step: 1,
    markerValue: SPEED_LEVELS.indexOf(1.0)
  });

  let lastNonNormalSpeed = 1.5;
  const paint = () => {
    const text = formatRate(video.playbackRate);
    buttonLabel.textContent = text;
    render({ value: closestSpeedIndex(video.playbackRate), text });
    button.setAttribute('aria-pressed', String(video.playbackRate !== 1));
  };
  paint();

  button.addEventListener('click', (event) => {
    if (video.playbackRate !== 1.0) {
      lastNonNormalSpeed = video.playbackRate;
      video.playbackRate = 1.0;
    } else {
      video.playbackRate = lastNonNormalSpeed;
    }
    options.blurMouseToggle(event, button);
  });
  slider.addEventListener('input', () => {
    const rate = SPEED_LEVELS[parseInt(slider.value, 10)];
    video.playbackRate = rate;
    if (rate !== 1.0) lastNonNormalSpeed = rate;
    paint();
  });
  return { container, button, slider, sync: paint };
}
