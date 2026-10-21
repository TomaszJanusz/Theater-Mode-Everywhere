import type { DisposableScope } from '../core/disposable-scope';

import { bindSliderPopover } from './menu-popover';
import { armPictureDismissOnLeave } from './picture-dismiss';

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

const formatRate = (rate: number) => `${rate.toFixed(2).replace(/\.00$|\.0$/, '')}x`;

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

  const panel = document.createElement('div');
  panel.className = 'theater-speed-panel';
  const tooltip = document.createElement('div');
  tooltip.className = 'theater-speed-tooltip-vertical';
  const sliderWrapper = document.createElement('div');
  sliderWrapper.className = 'theater-vertical-slider-wrapper';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.setAttribute('aria-label', label);
  slider.setAttribute('aria-orientation', 'vertical');
  slider.className = 'theater-speed-slider theater-vertical-slider';
  slider.min = '0';
  slider.max = String(SPEED_LEVELS.length - 1);
  slider.step = '1';
  const tick1x = document.createElement('div');
  tick1x.className = 'speed-tick-1x-vertical';
  sliderWrapper.append(slider, tick1x);
  panel.append(tooltip, sliderWrapper);
  container.append(button, panel);
  bindSliderPopover(container, panel, scope);

  let lastNonNormalSpeed = 1.5;
  const paint = () => {
    const index = closestSpeedIndex(video.playbackRate);
    const pct = (index / (SPEED_LEVELS.length - 1)) * 100;
    const accent = 'var(--accent-color, #6366f1)';
    slider.style.setProperty('background', `linear-gradient(to right, ${accent} 0%, ${accent} ${pct}%, rgba(255, 255, 255, 0.2) ${pct}%, rgba(255, 255, 255, 0.2) 100%)`, 'important');
    const text = formatRate(video.playbackRate);
    buttonLabel.textContent = text;
    tooltip.textContent = text;
    slider.setAttribute('aria-valuetext', text);
    button.setAttribute('aria-pressed', String(video.playbackRate !== 1));
  };
  const sync = () => {
    slider.value = String(closestSpeedIndex(video.playbackRate));
    paint();
  };
  sync();

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
  return { container, button, slider, sync };
}
