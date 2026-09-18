import { isDisneyHost, isTwitchHost } from '../providers/hosts';
import { THEATER_VIDEO_ATTR, THEATER_VIDEO_CLASS } from '../platform/active-video';

export const DISNEY_THEATER_STAGE_ID = 'theater-everywhere-disney-stage';
export const DISNEY_THEATER_STAGE_CLASS = 'theater-everywhere-disney-stage';
export const TWITCH_THEATER_STAGE_CLASS = 'theater-everywhere-twitch-stage';

const VIEWPORT_PIN_EPSILON_PX = 1;

export function theaterViewportPinOffset(
  rect: { top: number; left: number },
  current: { top: number; left: number }
): { top: number; left: number } | null {
  if (Math.abs(rect.top) <= VIEWPORT_PIN_EPSILON_PX && Math.abs(rect.left) <= VIEWPORT_PIN_EPSILON_PX) {
    return null;
  }
  return {
    top: current.top - rect.top,
    left: current.left - rect.left
  };
}

export function resolveTheaterViewportPin(options: {
  twitchStage: boolean;
  rect: { top: number; left: number };
  current: { top: number; left: number };
}): { top: number; left: number } | null {
  if (options.twitchStage) {
    if (options.current.top === 0 && options.current.left === 0) return null;
    return { top: 0, left: 0 };
  }
  return theaterViewportPinOffset(options.rect, options.current);
}

function readPinnedPx(element: HTMLElement, property: 'top' | 'left'): number {
  const raw = element.style.getPropertyValue(property).trim();
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(raw);
  return match ? Number(match[1]) : 0;
}

export function applyTheaterViewportPin(element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  const next = resolveTheaterViewportPin({
    twitchStage: document.documentElement.classList.contains(TWITCH_THEATER_STAGE_CLASS)
      || isTwitchHost(),
    rect,
    current: {
      top: readPinnedPx(element, 'top'),
      left: readPinnedPx(element, 'left')
    }
  });
  if (!next) return;
  const top = `${next.top}px`;
  const left = `${next.left}px`;
  if (element.style.getPropertyValue('top') !== top) {
    element.style.setProperty('top', top, 'important');
  }
  if (element.style.getPropertyValue('left') !== left) {
    element.style.setProperty('left', left, 'important');
  }
}

export function markTheaterVideo(element: HTMLElement): void {
  element.setAttribute(THEATER_VIDEO_ATTR, '');
  if (!element.classList.contains(THEATER_VIDEO_CLASS)) {
    element.classList.add(THEATER_VIDEO_CLASS);
  }
}

export function unmarkTheaterVideo(element: HTMLElement): void {
  element.removeAttribute(THEATER_VIDEO_ATTR);
  element.classList.remove(THEATER_VIDEO_CLASS);
}

export function theaterVideoNeedsRestyle(element: {
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
}): boolean {
  if (!element.hasAttribute(THEATER_VIDEO_ATTR)) return true;
  const style = element.getAttribute('style') ?? '';
  return !style.includes('position:')
    || !style.includes('--theater-object-fit')
    || !(style.includes('background:') || style.includes('background-color:'));
}

export function mountDisneyTheaterStage(hostname: string): void {
  if (!isDisneyHost(hostname)) return;
  document.documentElement.classList.add(DISNEY_THEATER_STAGE_CLASS);
  if (document.getElementById(DISNEY_THEATER_STAGE_ID)) return;
  const stage = document.createElement('div');
  stage.id = DISNEY_THEATER_STAGE_ID;
  stage.setAttribute('aria-hidden', 'true');
  document.documentElement.appendChild(stage);
}

export function mountTwitchTheaterStage(hostname: string): void {
  if (!isTwitchHost(hostname)) return;
  document.documentElement.classList.add(TWITCH_THEATER_STAGE_CLASS);
}

export function observeTwitchTheaterStage(hostname: string): () => void {
  if (!isTwitchHost(hostname)) return () => {};
  const html = document.documentElement;
  const restore = (): void => {
    if (!html.classList.contains(TWITCH_THEATER_STAGE_CLASS)) {
      html.classList.add(TWITCH_THEATER_STAGE_CLASS);
    }
  };
  restore();
  const observer = new MutationObserver(restore);
  observer.observe(html, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

export function unmountDisneyTheaterStage(): void {
  document.documentElement.classList.remove(DISNEY_THEATER_STAGE_CLASS);
  document.getElementById(DISNEY_THEATER_STAGE_ID)?.remove();
}

export function unmountTwitchTheaterStage(): void {
  document.documentElement.classList.remove(TWITCH_THEATER_STAGE_CLASS);
}
