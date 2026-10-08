import { OwnedDom } from './owned-dom';
import type { ChatSurface, ChatTheme } from './types';

/** Parent-document signal. The page world reads it and calls YouTube's own theme method. */
export const CHAT_THEME_ATTRIBUTE = 'data-theater-chat-theme';

const YOUTUBE_BACKGROUND = 'var(--yt-live-chat-background-color)';

/**
 * Twitch publishes these as `--color-*` tokens. The fallbacks match the light and
 * dark values observed on a live channel; a stylesheet on the page replaces them
 * when it still contains the official token block.
 */
const TWITCH_LIGHT: Record<string, string> = {
  '--color-background-body': '#f7f7f8',
  '--color-background-base': '#ffffff',
  '--color-background-alt': '#efeff1',
  '--color-background-alt-2': '#e6e6ea',
  '--color-text-base': '#0e0e10',
  '--color-text-alt': '#0e0e10',
  '--color-text-link': '#5c16c5',
  '--color-text-input': '#0e0e10',
  '--color-border-base': 'rgba(83, 83, 95, 0.48)'
};

const TWITCH_DARK: Record<string, string> = {
  '--color-background-body': '#0e0e10',
  '--color-background-base': '#18181b',
  '--color-background-alt': '#1f1f23',
  '--color-background-alt-2': '#26262c',
  '--color-text-base': '#efeff1',
  '--color-text-alt': '#adadb8',
  '--color-text-alt-2': '#848494',
  '--color-text-link': '#a970ff',
  '--color-text-input': '#efeff1',
  '--color-border-base': 'rgba(83, 83, 95, 0.48)'
};

type YouTubeApp = HTMLElement & {
  setGlobalDarkTheme?: (dark: boolean) => void;
};

type ForcedTheme = 'light' | 'dark';

const paletteCache = new WeakMap<Document, Partial<Record<ForcedTheme, Record<string, string>>>>();

export function normalizeChatTheme(value: unknown): ChatTheme {
  return value === 'light' || value === 'native' || value === 'dark' ? value : 'native';
}

/**
 * Applies light or dark with the service's own palette and restores it afterward.
 * `native` leaves the chat untouched. Nothing here rewrites an iframe URL.
 */
export class ChatThemeSession {
  private readonly owned = new OwnedDom();
  private surface: ChatSurface | null = null;
  private theme: ChatTheme = 'native';
  private youtubeWasDark: boolean | null = null;
  private timer: number | null = null;

  update(surface: ChatSurface | null, theme: ChatTheme): void {
    if (!surface || theme === 'native') {
      this.clear();
      return;
    }
    if (this.surface && (this.surface.root !== surface.root || this.surface.iframe !== surface.iframe)) this.clear();
    this.surface = surface;
    this.theme = theme;
    this.apply();
    this.arm();
  }

  dispose(): void {
    this.clear();
  }

  private apply(): void {
    const surface = this.surface;
    const theme = this.theme;
    if (!surface || (theme !== 'light' && theme !== 'dark')) return;
    this.owned.setAttribute(surface.root.ownerDocument.documentElement, CHAT_THEME_ATTRIBUTE, theme);
    if (surface.provider === 'twitch') this.applyTwitch(surface, theme);
    else this.applyYouTube(surface, theme);
  }

  private applyTwitch(surface: ChatSurface, theme: ForcedTheme): void {
    const palette = twitchPalette(surface.root.ownerDocument, theme);
    for (const [name, value] of Object.entries(palette)) this.owned.setProperty(surface.root, name, value);
    const room = surface.contentRoot ?? surface.root;
    // The room background is a literal service color. Point it at the same token the text already uses.
    this.owned.setProperty(room, 'background-color', 'var(--color-background-base)');
    this.owned.setProperty(room, 'color', 'var(--color-text-base)');
  }

  private applyYouTube(surface: ChatSurface, theme: ForcedTheme): void {
    const doc = youtubeDocument(surface);
    if (!doc) return;
    const app = doc.querySelector('yt-live-chat-app');
    if (isElement(app)) this.syncYouTubeApp(app, doc, theme);
    const renderer = doc.querySelector('yt-live-chat-renderer');
    // setGlobalDarkTheme updates the palette variables, but the renderer host keeps a literal background.
    if (isElement(renderer)) this.owned.setProperty(renderer, 'background-color', YOUTUBE_BACKGROUND);
  }

  private syncYouTubeApp(app: HTMLElement, doc: Document, theme: ForcedTheme): void {
    const method = (app as YouTubeApp).setGlobalDarkTheme;
    if (typeof method !== 'function') return;
    const wantDark = theme === 'dark';
    if (this.youtubeWasDark === null) this.youtubeWasDark = doc.documentElement.hasAttribute('dark');
    if (doc.documentElement.hasAttribute('dark') === wantDark) return;
    try {
      method.call(app, wantDark);
    } catch {
      // The page method is optional. The attribute bridge retries from the page world.
    }
  }

  private arm(): void {
    if (this.timer !== null) return;
    const view = this.surface?.root.ownerDocument.defaultView;
    if (!view) return;
    this.timer = view.setInterval(() => this.apply(), 700);
  }

  private clear(): void {
    if (this.timer !== null) {
      const view = this.surface?.root.ownerDocument.defaultView;
      view?.clearInterval(this.timer);
      this.timer = null;
    }
    this.restoreYouTube();
    this.owned.restoreAll();
    this.surface = null;
    this.theme = 'native';
  }

  private restoreYouTube(): void {
    const surface = this.surface;
    const previous = this.youtubeWasDark;
    this.youtubeWasDark = null;
    if (!surface || previous === null) return;
    const doc = youtubeDocument(surface);
    const app = doc?.querySelector('yt-live-chat-app');
    const method = isElement(app) ? (app as YouTubeApp).setGlobalDarkTheme : undefined;
    if (!doc || typeof method !== 'function' || !isElement(app)) return;
    if (doc.documentElement.hasAttribute('dark') === previous) return;
    try {
      method.call(app, previous);
    } catch {
      // Leaving the service attribute in place is safer than guessing a second write.
    }
  }
}

/**
 * Page-world half of the YouTube switch. Content scripts can see the chat DOM
 * but not `yt-live-chat-app.setGlobalDarkTheme`, which is what retargets the palette.
 */
export function installYouTubeChatThemeBridge(doc: Document): void {
  const view = doc.defaultView;
  if (!view) return;
  const flag = Symbol.for('theater-everywhere.chat-theme-bridge');
  const marked = view as unknown as { [key: symbol]: boolean };
  if (marked[flag]) return;
  marked[flag] = true;
  const mount = () => mountYouTubeChatThemeBridge(doc);
  if (doc.documentElement) mount();
  else doc.addEventListener('DOMContentLoaded', mount, { once: true });
}

function mountYouTubeChatThemeBridge(doc: Document): void {
  const root = doc.documentElement;
  if (!root) return;
  let snapshot: boolean | null = null;
  let timer: number | null = null;

  const apply = () => {
    const theme = root.getAttribute(CHAT_THEME_ATTRIBUTE);
    const forced = theme === 'light' || theme === 'dark';
    if (forced && timer === null) timer = doc.defaultView?.setInterval(apply, 700) ?? null;
    const frame = doc.querySelector('iframe#chatframe');
    if (!(frame instanceof HTMLIFrameElement)) return;
    let chat: Document | null = null;
    try {
      chat = frame.contentDocument;
    } catch {
      return;
    }
    if (!chat) return;
    const app = chat.querySelector('yt-live-chat-app');
    const method = isElement(app) ? (app as YouTubeApp).setGlobalDarkTheme : undefined;
    if (!forced) {
      if (snapshot !== null && typeof method === 'function' && isElement(app)) {
        try {
          method.call(app, snapshot);
        } catch { /* Restore is best-effort once the app is gone. */ }
      }
      snapshot = null;
      if (timer !== null) {
        doc.defaultView?.clearInterval(timer);
        timer = null;
      }
      return;
    }
    if (typeof method !== 'function' || !isElement(app)) return;
    if (snapshot === null) snapshot = chat.documentElement.hasAttribute('dark');
    const wantDark = theme === 'dark';
    if (chat.documentElement.hasAttribute('dark') !== wantDark) {
      try {
        method.call(app, wantDark);
      } catch { /* The next tick retries after the app finishes upgrading. */ }
    }
  };

  const observer = new MutationObserver(apply);
  observer.observe(root, { attributes: true, attributeFilter: [CHAT_THEME_ATTRIBUTE] });
  doc.addEventListener('load', (event) => {
    const target = event.target;
    if (target instanceof HTMLIFrameElement && target.id === 'chatframe') apply();
  }, true);
  apply();
}

/** `instanceof HTMLElement` is false for nodes that belong to another frame. */
function isElement(value: unknown): value is HTMLElement {
  return typeof value === 'object' && value !== null && (value as Node).nodeType === 1;
}

function youtubeDocument(surface: ChatSurface): Document | null {
  const frame = surface.iframe;
  if (!frame) return null;
  try {
    return frame.contentDocument;
  } catch {
    return null;
  }
}

function twitchPalette(doc: Document, theme: ForcedTheme): Record<string, string> {
  let cached = paletteCache.get(doc);
  if (!cached) {
    cached = {};
    paletteCache.set(doc, cached);
    cached.light = paletteFromStyles(doc, 'light');
    cached.dark = paletteFromStyles(doc, 'dark');
  }
  const found = cached[theme];
  if (found && Object.keys(found).length > 3) return found;
  return theme === 'dark' ? TWITCH_DARK : TWITCH_LIGHT;
}

function paletteFromStyles(doc: Document, theme: ForcedTheme): Record<string, string> | undefined {
  try {
    for (const sheet of doc.styleSheets) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules) {
        const text = rule.cssText || '';
        if (!text.includes('--color-background-base')) continue;
        const base = /--color-background-base\s*:\s*([^;]+)/.exec(text)?.[1]?.trim().toLowerCase() ?? '';
        const matched = theme === 'dark' ? base.includes('18181b') : /#fff\b|#ffffff/.test(base);
        if (!matched) continue;
        const tokens: Record<string, string> = {};
        for (const match of text.matchAll(/(--color-[\w-]+)\s*:\s*([^;]+)/g)) tokens[match[1]] = match[2].trim();
        if (Object.keys(tokens).length > 3) return tokens;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}
