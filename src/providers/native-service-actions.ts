import type { ServiceAction, ServiceActionSource } from '../core/service-actions';

export type NativeServiceActionHooks = {
  enabled?: () => boolean;
  host?: () => boolean;
  href?: () => string;
  document?: Document;
  /** Bind controls to the surface that owns the current theater session. */
  element?: HTMLElement;
};

export type NativeServiceAction = ServiceAction & { element: HTMLElement };

const tokens = new WeakMap<Element, number>();
let serial = 0;

export function serviceElementToken(element: Element): number {
  let token = tokens.get(element);
  if (token === undefined) { token = ++serial; tokens.set(element, token); }
  return token;
}

/** Tracking parameters do not replace a title; playlist parts and episodes do. */
export function serviceActionRoute(href: string, keys: readonly string[] = []): string {
  const url = new URL(href);
  return JSON.stringify([url.origin, url.pathname, ...keys.map(key => url.searchParams.get(key))]);
}

export function servicePlayer(doc: Document, selector: string, element?: HTMLElement): HTMLElement | null {
  const root = element ? element.closest(selector) : doc.querySelector(selector);
  return root instanceof HTMLElement && root.isConnected && root.querySelector('video') ? root : null;
}

/** Host chrome hidden by theater CSS remains actionable; absent/disabled controls do not. */
export function usableServiceControl(element: HTMLElement): boolean {
  if (!element.isConnected || element.matches(':disabled')) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden || node.hasAttribute('inert') || node.getAttribute('aria-disabled') === 'true' || node.getAttribute('aria-hidden') === 'true'
      || node.classList.contains('disabled') || node.classList.contains('bpx-state-disabled')
      || getComputedStyle(node).display === 'none') return false;
  }
  return true;
}

export function serviceControlLabel(element: HTMLElement): string {
  return (element.textContent?.trim() || element.getAttribute('aria-label') || element.getAttribute('title') || '')
    .replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function nativeServiceActionId(provider: string, route: string, root: HTMLElement, element: HTMLElement, media?: HTMLElement): string {
  const video = media instanceof HTMLVideoElement ? media : root.querySelector<HTMLVideoElement>('video');
  return JSON.stringify([provider, route, serviceElementToken(root), serviceElementToken(element),
    video && serviceElementToken(video), video?.currentSrc || '', video?.getAttribute('src') || '', serviceControlLabel(element)]);
}

/** Reads and activations share exactly the same availability and identity checks. */
export function nativeServiceActionSource(live: () => NativeServiceAction[]): ServiceActionSource {
  const read = (): NativeServiceAction[] => {
    try { return live(); } catch { return []; }
  };
  return {
    read: () => read().map(({ element: _element, ...action }) => action),
    activate(id) {
      const action = read().find(action => action.id === id);
      if (!action || !usableServiceControl(action.element)) return false;
      action.element.click();
      return true;
    }
  };
}
