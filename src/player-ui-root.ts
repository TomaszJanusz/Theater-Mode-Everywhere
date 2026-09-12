const HOST_ID = 'theater-everywhere-ui';
const STYLE_ID = 'theater-everywhere-ui-styles';
const UI_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

let hostEl: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;

function isolateHost(host: HTMLElement): void {
  const styles: Array<[string, string]> = [
    ['all', 'initial'],
    ['position', 'fixed'],
    ['inset', '0px'],
    ['width', '100%'],
    ['height', '100%'],
    ['display', 'block'],
    ['pointer-events', 'none'],
    ['z-index', '2147483647'],
    ['font-family', UI_FONT],
    ['line-height', '1.4'],
    ['color', '#f8fafc'],
    ['-webkit-font-smoothing', 'antialiased'],
    ['-moz-osx-font-smoothing', 'grayscale']
  ];
  for (const [property, value] of styles) {
    host.style.setProperty(property, value, 'important');
  }
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

function extensionContentCssUrl(): string | null {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      return chrome.runtime.getURL('content.css');
    }
  } catch {
    // Local test pages have no extension runtime.
  }
  return null;
}

function ensureShadowStyles(root: ShadowRoot): void {
  if (root.getElementById(STYLE_ID)) return;

  const reset = document.createElement('style');
  reset.id = `${STYLE_ID}-reset`;
  reset.textContent = `
    :host {
      all: initial;
      font-family: ${UI_FONT} !important;
      line-height: 1.4 !important;
      color: #f8fafc !important;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
  `;
  root.appendChild(reset);

  const injected = collectInjectedTheaterCss();
  if (injected) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = injected;
    root.appendChild(style);
    return;
  }

  const href = extensionContentCssUrl();
  if (!href) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = href;
  root.appendChild(link);
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
  isolateHost(hostEl);
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
