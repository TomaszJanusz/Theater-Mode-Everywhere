import { TwitchChatThemeAdapter } from './adapters/twitch';
import type { ChatThemeAdapter } from './adapters/types';
import { YouTubeChatThemeAdapter } from './adapters/youtube';
import { OwnedDom } from './owned-dom';
import { TWITCH_CHAT_PORTAL_SELECTOR } from './selectors';
import type { ChatSurface, ChatTheme, ChatThemeStatus } from './types';

export const CHAT_THEME_ATTRIBUTE = 'data-theater-chat-theme';

/** Fallback for palette edits that do not mutate the DOM, such as a CSS rule property change. */
const THEME_POLL_MS = 700;

const THEME_NODE_SELECTOR = `style, link, ${TWITCH_CHAT_PORTAL_SELECTOR}`;

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
  private observer: MutationObserver | null = null;
  private observedDoc: Document | null = null;
  private visibilityDocument: Document | null = null;
  private sheetKey = '';
  private paletteRules: CSSStyleRule[] = [];
  private paletteCss = '';
  status: ChatThemeStatus = 'native';

  constructor(private readonly onStatusChange: () => void = () => {}) {}

  update(surface: ChatSurface | null, theme: ChatTheme): void {
    if (!surface || theme === 'native') { this.clear(); return; }
    if (this.surface !== surface) this.clear();
    this.surface = surface;
    this.theme = theme;
    this.listenVisibility(surface.root.ownerDocument);
    if (surface.root.ownerDocument.hidden) {
      this.pause();
      return;
    }
    this.apply(true);
    this.resume();
  }

  dispose(): void { this.clear(); }

  private readonly onVisibility = (): void => {
    const surface = this.surface;
    if (!surface || this.theme === 'native') return;
    if (surface.root.ownerDocument.hidden) {
      this.pause();
      return;
    }
    const previous = this.status;
    this.apply(true);
    this.resume();
    if (this.status !== previous) this.onStatusChange();
  };

  private apply(force: boolean): void {
    const surface = this.surface;
    const theme = this.theme;
    if (!surface || theme === 'native') return;
    if (surface.root.ownerDocument.hidden) return;
    const doc = themeDocument(surface);
    if (!force && doc === this.doc && this.adapter && !this.paletteChanged(doc)) return;
    if (this.doc !== doc) {
      this.adapter?.restore();
      this.adapter = null;
    }
    this.doc = doc;
    // SOOP has no palette to map: its chat keeps the service's own appearance.
    if (surface.provider === 'soop') {
      this.status = 'unavailable';
      return;
    }
    if (!this.adapter && doc) {
      this.adapter = surface.provider === 'twitch'
        ? new TwitchChatThemeAdapter(surface) : new YouTubeChatThemeAdapter(doc);
    }
    const applied = this.adapter?.apply(theme) ?? false;
    this.status = applied ? 'applied' : 'unavailable';
    if (applied) this.owned.setAttribute(surface.root.ownerDocument.documentElement, CHAT_THEME_ATTRIBUTE, theme);
    else this.owned.restoreAll();
    this.rememberPalette(doc);
    if (this.observedDoc !== doc) this.watchDom(doc);
  }

  /** Re-reads the palette only. Portal and style nodes schedule a full apply from the observer. */
  private tick(): void {
    const surface = this.surface;
    if (!surface || this.theme === 'native' || surface.root.ownerDocument.hidden) return;
    const doc = themeDocument(surface);
    if (doc !== this.doc || this.paletteChanged(doc)) this.apply(true);
  }

  private resume(): void {
    const surface = this.surface;
    if (!surface || this.theme === 'native' || surface.root.ownerDocument.hidden) return;
    if (this.timer === null) {
      const view = surface.root.ownerDocument.defaultView;
      if (!view) return;
      this.timer = view.setInterval(() => {
        const previous = this.status;
        this.tick();
        if (this.status !== previous) this.onStatusChange();
      }, THEME_POLL_MS);
    }
    if (this.observedDoc !== this.doc) this.watchDom(this.doc);
  }

  private pause(): void {
    if (this.timer !== null) {
      this.surface?.root.ownerDocument.defaultView?.clearInterval(this.timer);
      this.timer = null;
    }
    this.observer?.disconnect();
    this.observer = null;
    this.observedDoc = null;
  }

  private watchDom(doc: Document | null): void {
    this.observer?.disconnect();
    this.observer = null;
    this.observedDoc = null;
    if (!doc?.documentElement || this.surface?.root.ownerDocument.hidden) return;
    const observer = new MutationObserver((records) => {
      if (this.surface?.root.ownerDocument.hidden) return;
      if (!records.some(themeDomChanged)) return;
      const previous = this.status;
      this.apply(true);
      if (this.status !== previous) this.onStatusChange();
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    this.observer = observer;
    this.observedDoc = doc;
  }

  private listenVisibility(doc: Document): void {
    if (this.visibilityDocument === doc) return;
    this.silenceVisibility();
    doc.addEventListener('visibilitychange', this.onVisibility);
    this.visibilityDocument = doc;
  }

  private silenceVisibility(): void {
    this.visibilityDocument?.removeEventListener('visibilitychange', this.onVisibility);
    this.visibilityDocument = null;
  }

  private paletteChanged(doc: Document | null): boolean {
    if (!doc) return this.sheetKey !== '';
    if (this.paletteKey(doc) !== this.sheetKey) return true;
    return this.paletteRules.map(ruleText).join('\0') !== this.paletteCss;
  }

  private rememberPalette(doc: Document | null): void {
    if (!doc) {
      this.sheetKey = '';
      this.paletteRules = [];
      this.paletteCss = '';
      return;
    }
    this.sheetKey = this.paletteKey(doc);
    this.paletteRules = collectPaletteRules(doc);
    this.paletteCss = this.paletteRules.map(ruleText).join('\0');
  }

  private paletteKey(doc: Document): string {
    const sheets = [...doc.styleSheets];
    const counts = sheets.map(sheet => { try { return sheet.cssRules.length; } catch { return -1; } });
    return `${sheets.length}:${counts.join(',')}`;
  }

  private clear(): void {
    this.pause();
    this.silenceVisibility();
    this.adapter?.restore();
    this.adapter = null;
    this.doc = null;
    this.owned.restoreAll();
    this.surface = null;
    this.theme = 'native';
    this.status = 'native';
    this.rememberPalette(null);
  }
}

function themeDocument(surface: ChatSurface): Document | null {
  try { return surface.provider === 'youtube' ? surface.iframe?.contentDocument ?? null : surface.root.ownerDocument; }
  catch { return null; }
}

/** Style, link, and portal nodes. Chat transcripts and our own UI are ignored before any subtree scan. */
function themeDomChanged(record: MutationRecord): boolean {
  if (record.type !== 'childList') return false;
  for (const node of [...record.addedNodes, ...record.removedNodes]) {
    if (!(node instanceof Element)) continue;
    const tag = node.tagName;
    if (tag === 'STYLE' || tag === 'LINK' || node.matches(TWITCH_CHAT_PORTAL_SELECTOR)) return true;
    if (tag.startsWith('YT-LIVE-CHAT-') || node.classList.contains('chat-line__message') || node.classList.contains('chat-line')) continue;
    if (node.id === 'theater-everywhere-ui' || node.closest('#theater-everywhere-ui')) continue;
    const parent = node.parentElement;
    if (parent !== node.ownerDocument.head && parent !== node.ownerDocument.body) continue;
    if (node.querySelector(THEME_NODE_SELECTOR)) return true;
  }
  return false;
}

function collectPaletteRules(doc: Document): CSSStyleRule[] {
  const found: CSSStyleRule[] = [];
  const visit = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules);
      if (!('style' in rule) || !('selectorText' in rule)) continue;
      const styleRule = rule as CSSStyleRule;
      if (styleRule.style.getPropertyValue('--color-background-base')
        || styleRule.style.getPropertyValue('--color-text-base')
        || styleRule.selectorText.includes('theater-chat-theme-')) found.push(styleRule);
    }
  };
  for (const sheet of doc.styleSheets) {
    try { visit(sheet.cssRules); } catch { /* Opaque service sheets are not a palette signal. */ }
  }
  return found;
}

function ruleText(rule: CSSStyleRule): string {
  try { return rule.cssText; } catch { return ''; }
}
