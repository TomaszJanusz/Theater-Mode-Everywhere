const HOST_ID = 'theater-everywhere-ui';
const STYLE_ID = 'theater-everywhere-ui-styles';

let hostEl: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let playerUiCss = '';

export function setPlayerUiCss(css: string): void {
  playerUiCss = css;
  if (shadow && hostEl?.isConnected) ensureShadowStyles(shadow);
}

function collectInjectedTheaterCss(): string {
  const chunks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const text = Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n');
      if (text.includes('.theater-controls-wrapper')) chunks.push(text);
    } catch {
      // Cross-origin page stylesheets are opaque; skip them.
    }
  }
  return chunks.join('\n');
}

function ensureShadowStyles(root: ShadowRoot): void {
  const css = playerUiCss || collectInjectedTheaterCss();
  const existing = root.getElementById(STYLE_ID);
  if (existing) {
    if (css && existing.tagName === 'STYLE' && existing.textContent !== css) {
      existing.textContent = css;
    }
    return;
  }

  // Inline the skin before chrome is mounted. A <link rel="stylesheet"> to
  // content.css paints the shadow tree as raw HTML until the sheet loads.
  if (css) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    root.appendChild(style);
    return;
  }

  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      const link = document.createElement('link');
      link.id = STYLE_ID;
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL('content.css');
      root.appendChild(link);
    }
  } catch {
    // Local test pages have no extension runtime.
  }
}

export function getPlayerUiRoot(): ShadowRoot {
  if (shadow && hostEl?.isConnected) return shadow;

  hostEl = document.getElementById(HOST_ID);
  if (!hostEl) {
    hostEl = document.createElement('div');
    hostEl.id = HOST_ID;
    hostEl.setAttribute('data-theater-everywhere-ui', '');
    (document.documentElement || document.body).appendChild(hostEl);
  }
  shadow = hostEl.shadowRoot || hostEl.attachShadow({ mode: 'open' });
  ensureShadowStyles(shadow);
  return shadow;
}

export function peekPlayerUiRoot(): ShadowRoot | null {
  if (shadow && hostEl?.isConnected) return shadow;
  const host = document.getElementById(HOST_ID);
  return host?.shadowRoot || null;
}

export function mountPlayerUi(el: HTMLElement): HTMLElement {
  getPlayerUiRoot().appendChild(el);
  return el;
}

export function queryPlayerUi<T extends Element>(selector: string): T | null {
  return (peekPlayerUiRoot()?.querySelector(selector) || null) as T | null;
}

export function queryPlayerUiAll<T extends Element>(selector: string): T[] {
  const root = peekPlayerUiRoot();
  return root ? Array.from(root.querySelectorAll<T>(selector)) : [];
}

export function destroyPlayerUi(): void {
  hostEl?.remove();
  hostEl = null;
  shadow = null;
}

export function eventPathIncludes(event: Event, node: Node | null): boolean {
  if (!node) return false;
  return event.composedPath().includes(node);
}

export function eventPathMatches(event: Event, selector: string): boolean {
  return event.composedPath().some((entry) => entry instanceof Element && entry.matches(selector));
}
