import { isTencentHost } from '../hosts';
import { isTencentWasmPlayerElement } from './wasm-player';

export const TENCENT_THEATER_STAGE_CLASS = 'theater-everywhere-tencent-stage';

export function mountTencentTheaterStage(hostname: string, element: HTMLElement): void {
  if (!isTencentHost(hostname)) return;
  if (!isTencentWasmPlayerElement(element)) return;
  document.documentElement.classList.add(TENCENT_THEATER_STAGE_CLASS);
}

export function unmountTencentTheaterStage(): void {
  document.documentElement.classList.remove(TENCENT_THEATER_STAGE_CLASS);
}

export function injectTencentWasmFrameStyles(shadowRoot: ShadowRoot): void {
  if (shadowRoot.host?.localName !== 'fake-iframe-video') return;
  if (shadowRoot.getElementById('theater-everywhere-tencent-wasm-styles')) return;
  const styleEl = document.createElement('style');
  styleEl.id = 'theater-everywhere-tencent-wasm-styles';
  styleEl.textContent = 'iframe, canvas { width: 100% !important; height: 100% !important; }';
  shadowRoot.appendChild(styleEl);
}

export function tencentVideosShareContainer(current: HTMLVideoElement, replacement: HTMLVideoElement): boolean {
  return replacement.closest('.txp_videos_container') === current.closest('.txp_videos_container');
}

export const tencentTheaterStage = {
  mount(hostname: string, element: HTMLElement) {
    mountTencentTheaterStage(hostname, element);
  },
  unmount() {
    unmountTencentTheaterStage();
  }
};
