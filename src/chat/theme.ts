import { TwitchChatThemeAdapter } from './adapters/twitch';
import { YouTubeChatThemeAdapter } from './adapters/youtube';
import type { ChatThemeAdapter } from './adapters/types';
import { OwnedDom } from './owned-dom';
import type { ChatSurface, ChatTheme, ChatThemeStatus } from './types';

export const CHAT_THEME_ATTRIBUTE = 'data-theater-chat-theme';

export function normalizeChatTheme(value: unknown): ChatTheme {
  return value === 'light' || value === 'native' || value === 'dark' ? value : 'native';
}

/** Shared lifetime, readiness polling and restoration; adapters own the palette mechanism. */
export class ChatThemeSession {
  private readonly owned = new OwnedDom();
  private surface: ChatSurface | null = null;
  private theme: ChatTheme = 'native';
  private adapter: ChatThemeAdapter | null = null;
  private doc: Document | null = null;
  private timer: number | null = null;
  status: ChatThemeStatus = 'native';

  constructor(private readonly onStatusChange: () => void = () => {}) {}

  update(surface: ChatSurface | null, theme: ChatTheme): void {
    if (!surface || theme === 'native') { this.clear(); return; }
    if (this.surface !== surface) this.clear();
    this.surface = surface;
    this.theme = theme;
    this.apply();
    if (this.timer === null) {
      this.timer = surface.root.ownerDocument.defaultView?.setInterval(() => {
        const previous = this.status;
        this.apply();
        if (this.status !== previous) this.onStatusChange();
      }, 700) ?? null;
    }
  }

  dispose(): void { this.clear(); }

  private apply(): void {
    const surface = this.surface;
    const theme = this.theme;
    if (!surface || theme === 'native') return;
    const doc = themeDocument(surface);
    if (this.doc !== doc) {
      this.adapter?.restore();
      this.adapter = null;
      this.doc = doc;
    }
    if (!this.adapter && doc) {
      this.adapter = surface.provider === 'twitch'
        ? new TwitchChatThemeAdapter(surface) : new YouTubeChatThemeAdapter(doc);
    }
    const applied = this.adapter?.apply(theme) ?? false;
    this.status = applied ? 'applied' : 'unavailable';
    if (applied) this.owned.setAttribute(surface.root.ownerDocument.documentElement, CHAT_THEME_ATTRIBUTE, theme);
    else this.owned.restoreAll();
  }

  private clear(): void {
    if (this.timer !== null) this.surface?.root.ownerDocument.defaultView?.clearInterval(this.timer);
    this.timer = null;
    this.adapter?.restore();
    this.adapter = null;
    this.doc = null;
    this.owned.restoreAll();
    this.surface = null;
    this.theme = 'native';
    this.status = 'native';
  }
}

function themeDocument(surface: ChatSurface): Document | null {
  try { return surface.provider === 'youtube' ? surface.iframe?.contentDocument ?? null : surface.root.ownerDocument; }
  catch { return null; }
}
