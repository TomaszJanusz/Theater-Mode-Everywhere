import type { ProviderStage } from '../../core/provider-presentation';

import { isDisneyHost } from './hosts';

export const DISNEY_THEATER_STAGE_ID = 'theater-everywhere-disney-stage';
export const DISNEY_THEATER_STAGE_CLASS = 'theater-everywhere-disney-stage';

export const DISNEY_SHADOW_PARENT_CSS = `
    :host-context(html.theater-everywhere-disney-stage) .theater-everywhere-parent-active {
      width: 100% !important;
      height: 100% !important;
      min-width: 100% !important;
      min-height: 100% !important;
      overflow: visible !important;
      background: #000000 !important;
    }`;

const DISNEY_SHADOW_STYLE_ID = 'theater-everywhere-disney-shadow-styles';

/** Discovery's `prepareShadowRoot`: the stage sizes the theater parent inside the player's shadow root too. */
export function prepareDisneyShadowRoot(shadowRoot: ShadowRoot): void {
  if (shadowRoot.getElementById(DISNEY_SHADOW_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = DISNEY_SHADOW_STYLE_ID;
  style.textContent = DISNEY_SHADOW_PARENT_CSS;
  shadowRoot.appendChild(style);
}

export const DISNEY_CAPTION_STYLE_ID = 'theater-everywhere-disney-captions';

/** Disney writes font-size: 0px on the cue. Only a style inside its shadow can override that. */
export const DISNEY_CAPTION_SHADOW_CSS = `
.hive-subtitle-renderer-cue-window,
.hive-subtitle-renderer-cue,
.hive-subtitle-renderer-line {
  font-size: calc(28px * var(--theater-caption-scale, 1)) !important;
  line-height: 1.35 !important;
}
.timed-text-override-region {
  transition: inset-block-end 0.18s ease !important;
}
html[data-theater-everywhere-motion="reduced"] .timed-text-override-region { transition: none !important; }
.hive-subtitle-renderer-cue-positioning-box:not([style*="writing-mode: vertical-rl"]) {
  height: auto !important;
  top: auto !important;
  bottom: 0 !important;
  left: 0 !important;
  right: 0 !important;
  width: 100% !important;
}
`;

export function ensureDisneyCaptions(): void {
  const region = document.querySelector('timed-text-override-region');
  const shadow = region?.shadowRoot;
  if (!shadow || shadow.getElementById(DISNEY_CAPTION_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = DISNEY_CAPTION_STYLE_ID;
  style.textContent = DISNEY_CAPTION_SHADOW_CSS;
  shadow.appendChild(style);
}

function clearDisneyCaptions(): void {
  document.querySelector('timed-text-override-region')?.shadowRoot
    ?.getElementById(DISNEY_CAPTION_STYLE_ID)
    ?.remove();
}

export function mountDisneyTheaterStage(hostname: string): void {
  if (!isDisneyHost(hostname)) return;
  document.documentElement.classList.add(DISNEY_THEATER_STAGE_CLASS);
  ensureDisneyCaptions();
  if (document.getElementById(DISNEY_THEATER_STAGE_ID)) return;
  const stage = document.createElement('div');
  stage.id = DISNEY_THEATER_STAGE_ID;
  stage.setAttribute('aria-hidden', 'true');
  document.documentElement.appendChild(stage);
}

export function unmountDisneyTheaterStage(): void {
  document.documentElement.classList.remove(DISNEY_THEATER_STAGE_CLASS);
  document.getElementById(DISNEY_THEATER_STAGE_ID)?.remove();
  clearDisneyCaptions();
}

export const disneyTheaterStage: ProviderStage = {
  mount(hostname: string) {
    mountDisneyTheaterStage(hostname);
  },
  ensure(hostname: string) {
    if (!isDisneyHost(hostname)) return;
    ensureDisneyCaptions();
  },
  onStructuralMutation() {
    if (!document.documentElement.classList.contains(DISNEY_THEATER_STAGE_CLASS)) return;
    ensureDisneyCaptions();
  },
  unmount() {
    unmountDisneyTheaterStage();
  }
};
