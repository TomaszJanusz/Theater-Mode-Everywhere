import { isTwitchHost } from '../hosts';

export const TWITCH_THEATER_STAGE_CLASS = 'theater-everywhere-twitch-stage';

export function resolveTwitchPinToOrigin(current: { top: number; left: number }): { top: number; left: number } | null {
  if (current.top === 0 && current.left === 0) return null;
  return { top: 0, left: 0 };
}

function readPinnedPx(element: HTMLElement, property: 'top' | 'left'): number {
  const raw = element.style.getPropertyValue(property).trim();
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(raw);
  return match ? Number(match[1]) : 0;
}

export function twitchClaimsViewportPin(): boolean {
  return document.documentElement.classList.contains(TWITCH_THEATER_STAGE_CLASS) || isTwitchHost();
}

export function pinTwitchTheaterElement(element: HTMLElement): void {
  void element.getBoundingClientRect();
  const next = resolveTwitchPinToOrigin({
    top: readPinnedPx(element, 'top'),
    left: readPinnedPx(element, 'left')
  });
  if (next) {
    const top = `${next.top}px`;
    const left = `${next.left}px`;
    if (element.style.getPropertyValue('top') !== top) {
      element.style.setProperty('top', top, 'important');
    }
    if (element.style.getPropertyValue('left') !== left) {
      element.style.setProperty('left', left, 'important');
    }
  }
  if (!isTwitchHost()) return;
  element.style.setProperty('top', '0px', 'important');
  element.style.setProperty('left', '0px', 'important');
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

export function unmountTwitchTheaterStage(): void {
  document.documentElement.classList.remove(TWITCH_THEATER_STAGE_CLASS);
}

export const twitchTheaterStage = {
  mount(hostname: string) {
    mountTwitchTheaterStage(hostname);
  },
  ensure(hostname: string) {
    mountTwitchTheaterStage(hostname);
  },
  unmount() {
    unmountTwitchTheaterStage();
  },
  observe(hostname: string) {
    return observeTwitchTheaterStage(hostname);
  },
  claimsViewportPin() {
    return twitchClaimsViewportPin();
  },
  pinViewport(element: HTMLElement) {
    pinTwitchTheaterElement(element);
  }
};
