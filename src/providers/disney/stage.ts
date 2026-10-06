import { isDisneyHost } from '../hosts';

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

export function mountDisneyTheaterStage(hostname: string): void {
  if (!isDisneyHost(hostname)) return;
  document.documentElement.classList.add(DISNEY_THEATER_STAGE_CLASS);
  if (document.getElementById(DISNEY_THEATER_STAGE_ID)) return;
  const stage = document.createElement('div');
  stage.id = DISNEY_THEATER_STAGE_ID;
  stage.setAttribute('aria-hidden', 'true');
  document.documentElement.appendChild(stage);
}

export function unmountDisneyTheaterStage(): void {
  document.documentElement.classList.remove(DISNEY_THEATER_STAGE_CLASS);
  document.getElementById(DISNEY_THEATER_STAGE_ID)?.remove();
}

export const disneyTheaterStage = {
  mount(hostname: string) {
    mountDisneyTheaterStage(hostname);
  },
  unmount() {
    unmountDisneyTheaterStage();
  }
};
