import type { DisposableScope } from '../core/disposable-scope';
import type { PlaybackSurface } from '../playback-surface';

import { bindSliderPopover } from './menu-popover';
import { armPictureDismissOnLeave } from './picture-dismiss';

/** The slice of the playback surface the volume control reads and writes. */
export type VolumeSource = Pick<PlaybackSurface, 'volume' | 'muted' | 'logicalVolume'>;

/** Everything the control needs from the player, so it renders without a session. */
export interface VolumeControlOptions {
  video: VolumeSource;
  scope: DisposableScope;
  labels: { toggleMute: string; volume: string };
  /** Highest slider value; 1 unless volume boost is on and supported. */
  ceiling(): number;
  /** Fires when `ceiling()` may have changed; returns the unsubscribe. */
  onCeilingChange(listener: () => void): () => void;
  boostReady(): boolean;
  isSilent(): boolean;
  rememberAudible(volume: number): void;
  applyLevel(level: number): void;
  toggleMute(): void;
  stepVolume(direction: 'up' | 'down'): void;
  setIcon(element: HTMLElement, svg: string): void;
  updateCaptionDock(): void;
  blurMouseToggle(event: MouseEvent, button: HTMLElement): void;
}

export interface VolumeControl {
  container: HTMLElement;
  button: HTMLButtonElement;
  slider: HTMLInputElement;
  /** Re-read the video after its volume changed from outside the control. */
  sync(): void;
}

const WHEEL_DELTA_SCALE: Record<number, number> = {
  [WheelEvent.DOM_DELTA_LINE]: 100 / 3,
  [WheelEvent.DOM_DELTA_PAGE]: 100
};

const ICON_ATTRS = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const SPEAKER = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>';
const ICON_HIGH = `<svg ${ICON_ATTRS}>${SPEAKER}<path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
const ICON_LOW = `<svg ${ICON_ATTRS}>${SPEAKER}<path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
const ICON_MUTED = `<svg ${ICON_ATTRS}>${SPEAKER}<line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/** Wheel notches adjust volume across the speaker, slider and gap; stale gestures are discarded. */
function bindVolumeWheel(control: Pick<VolumeControl, 'container' | 'button' | 'slider'>, options: VolumeControlOptions): void {
  const { container, button, slider } = control;
  // A notch is roughly 100 CSS pixels (or three lines); share the remainder across targets.
  let remainder = 0;
  let lastWheelTime = -Infinity;
  const onWheel = (event: WheelEvent) => {
    if (button.disabled || slider.disabled || button.hidden || slider.hidden || container.hidden
      || container.getAttribute('aria-disabled') === 'true') return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
      || !Number.isFinite(event.deltaY) || event.deltaY === 0
      || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault();
    event.stopPropagation();
    const now = performance.now();
    if (now - lastWheelTime > 250) remainder = 0;
    lastWheelTime = now;
    const scale = WHEEL_DELTA_SCALE[event.deltaMode] ?? 1;
    // Bound momentum/large device deltas to one volume step per event.
    remainder += Math.max(-100, Math.min(100, event.deltaY * scale));
    const steps = Math.trunc(remainder / 100);
    remainder -= steps * 100;
    if (steps !== 0) options.stepVolume(steps < 0 ? 'up' : 'down');
  };
  for (const target of [button, slider, container]) {
    options.scope.listen(target, 'wheel', onWheel, { passive: false });
  }
}

export function createVolumeControl(options: VolumeControlOptions): VolumeControl {
  const { video, scope, labels } = options;
  let max = options.ceiling();

  const container = element('div', 'theater-volume-container theater-popover');
  container.addEventListener('pointerenter', options.updateCaptionDock);
  container.addEventListener('pointerleave', (event) => {
    armPictureDismissOnLeave(event, container);
    options.updateCaptionDock();
  });
  const button = element('button', 'theater-control-btn volume-btn');
  const panel = element('div', 'theater-volume-panel');
  const tooltip = element('div', 'theater-volume-tooltip-vertical');
  const sliderWrapper = element('div', 'theater-vertical-slider-wrapper');
  const slider = element('input', 'theater-volume-slider theater-vertical-slider');
  slider.type = 'range';
  slider.setAttribute('aria-label', labels.volume);
  slider.setAttribute('aria-orientation', 'vertical');
  slider.min = '0';
  slider.step = '0.05';
  if (video.volume > 0) options.rememberAudible(video.volume);
  const silentVolume = options.isSilent() ? 0 : video.volume;
  slider.value = String(video.logicalVolume ?? silentVolume);

  const tick100 = element('div', 'volume-tick-100-vertical');
  const applyMax = () => {
    slider.max = max.toFixed(1);
    tick100.style.display = max <= 1 ? 'none' : '';
  };
  applyMax();
  sliderWrapper.append(slider, tick100);
  panel.append(tooltip, sliderWrapper);
  button.setAttribute('aria-label', labels.toggleMute);

  const logicalVolume = () => video.muted ? 0 : (video.logicalVolume ?? video.volume);
  const updateIcon = () => {
    button.setAttribute('aria-pressed', String(options.isSilent()));
    const level = logicalVolume();
    button.classList.toggle('boosted', level > 1.0 && options.boostReady());
    const quiet = level < 0.5 ? ICON_LOW : ICON_HIGH;
    options.setIcon(button, video.muted || level === 0 ? ICON_MUTED : quiet);
  };
  const updateFill = () => {
    const level = logicalVolume();
    const fillPct = (level / max) * 100;
    const boosted = level > 1.0;
    const activeColor = boosted ? 'var(--theater-volume-boost-color)' : 'var(--accent-color, #6366f1)';
    slider.style.setProperty('background', `linear-gradient(to right, ${activeColor} 0%, ${activeColor} ${fillPct}%, rgba(255, 255, 255, 0.2) ${fillPct}%, rgba(255, 255, 255, 0.2) 100%)`, 'important');
    slider.classList.toggle('boosted', boosted);
  };
  const updateTooltip = () => {
    const level = logicalVolume();
    if (level <= 1.0) {
      tooltip.textContent = `${Math.round(level * 100)}%`;
      tooltip.style.color = '#f8fafc';
    } else {
      tooltip.textContent = `${Math.round(100 + (level - 1.0) * 400)}%`;
      tooltip.style.color = 'var(--theater-volume-boost-color)';
    }
    slider.setAttribute('aria-valuetext', tooltip.textContent ?? '');
  };
  const paint = () => {
    updateIcon();
    updateFill();
    updateTooltip();
  };
  paint();

  scope.listen(window, 'theater-everywhere-boost-ready' as keyof WindowEventMap, paint);
  scope.add(options.onCeilingChange(() => {
    const next = options.ceiling();
    if (next === max) return;
    max = next;
    applyMax();
    updateFill();
  }));

  button.addEventListener('click', (event) => {
    options.toggleMute();
    options.blurMouseToggle(event, button);
  });
  slider.addEventListener('input', () => {
    let value = parseFloat(slider.value);
    if (Math.abs(value - 1.0) <= 0.05) {
      value = 1.0;
      slider.value = '1.0';
    }
    video.logicalVolume = value;
    options.rememberAudible(value);
    if (value > 0 && video.muted) video.muted = false;
    options.applyLevel(value);
    paint();
  });

  container.append(button, panel);
  bindSliderPopover(container, panel, scope);
  const control = { container, button, slider, sync };
  bindVolumeWheel(control, options);

  function sync(): void {
    if (video.muted) {
      slider.value = '0';
    } else if (video.logicalVolume !== undefined && video.logicalVolume > 1.0 && video.volume === 1.0) {
      slider.value = String(video.logicalVolume);
      options.rememberAudible(video.logicalVolume);
    } else {
      video.logicalVolume = video.volume;
      slider.value = String(video.volume);
      options.rememberAudible(video.volume);
    }
    paint();
  }
  return control;
}
