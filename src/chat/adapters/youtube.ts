import { OwnedDom } from '../owned-dom';
import { THEATER_STAGE_BACKGROUND } from './stage';
import type { ChatThemeAdapter, ForcedTheme } from './types';
import { YOUTUBE_CHAT_KNOWN_REFERENCES, YOUTUBE_CHAT_MAPPED_ALIASES, YOUTUBE_CHAT_TOKEN_BRIDGE } from './youtube-palette';

/** The bridge stays inside the existing chat document; no service function is patched. */
export class YouTubeChatThemeAdapter implements ChatThemeAdapter {
  private readonly owned = new OwnedDom();
  private style: HTMLStyleElement | null = null;
  private canvas: HTMLStyleElement | null = null;
  private sheets: readonly CSSStyleSheet[] = [];
  private ruleCounts: number[] = [];
  private recognized: string | null = null;

  constructor(private readonly doc: Document) {}

  apply(theme: ForcedTheme): boolean {
    if (!this.supported()) { this.restore(); return false; }
    if (!this.style?.isConnected) {
      this.style = this.doc.createElement('style');
      this.style.setAttribute('data-theater-chat-palette', 'youtube');
      // v2_0 overrides this legacy token on the root. Borrow its native light
      // declaration for hovered thread lines instead of inventing a replacement color.
      this.style.textContent = YOUTUBE_CHAT_TOKEN_BRIDGE.replace('var(--yt-deprecated-general-background-c)', this.recognized!);
      this.doc.head.append(this.style);
    }
    if (theme === 'dark') this.owned.setAttribute(this.doc.documentElement, 'dark', '');
    else this.owned.removeAttribute(this.doc.documentElement, 'dark');
    this.paintCanvas(theme);
    return true;
  }

  restore(): void {
    this.canvas?.remove();
    this.canvas = null;
    this.style?.remove();
    this.style = null;
    this.owned.restoreAll();
  }

  /** YouTube's dark base is #0f0f0f. The message canvas uses the theater stage instead. */
  private paintCanvas(theme: ForcedTheme): void {
    if (theme !== 'dark') {
      this.canvas?.remove();
      this.canvas = null;
      return;
    }
    if (this.canvas?.isConnected || !this.doc.head) return;
    const style = this.doc.createElement('style');
    style.setAttribute('data-theater-chat-canvas', 'youtube');
    style.textContent = `html,body,yt-live-chat-app,yt-live-chat-renderer,yt-live-chat-header-renderer{background:${THEATER_STAGE_BACKGROUND} !important;background-color:${THEATER_STAGE_BACKGROUND} !important}`;
    this.doc.head.append(style);
    this.canvas = style;
  }

  private supported(): boolean {
    if (!this.doc.head || !this.doc.querySelector('yt-live-chat-app')
      || !this.doc.defaultView?.CSS.supports('color', 'color-mix(in srgb, white 20%, transparent)')) return false;
    const sheets = [...this.doc.styleSheets].filter(sheet => sheet !== this.style?.sheet);
    const counts = sheets.map(sheet => { try { return sheet.cssRules.length; } catch { return -1; } });
    if (sheets.length !== this.sheets.length || sheets.some((sheet, i) => sheet !== this.sheets[i] || counts[i] !== this.ruleCounts[i])) {
      this.sheets = sheets;
      this.ruleCounts = counts;
      this.recognized = recognizedPalette(sheets);
    }
    if (!this.recognized) return false;
    const values = this.doc.defaultView.getComputedStyle(this.doc.documentElement);
    // Inherited computed values include YouTube's own final palette overrides.
    const tokens = YOUTUBE_CHAT_TOKEN_BRIDGE.match(/--(?:yt-sys-color-baseline|yt-deprecated)-[\w-]+/g) ?? [];
    return tokens.every(token => {
      const value = values.getPropertyValue(token).trim();
      return Boolean(value) && this.doc.defaultView!.CSS.supports('color', value);
    });
  }
}

function recognizedPalette(sheets: readonly CSSStyleSheet[]): string | null {
  const declared = new Set<string>();
  let light = false;
  let dark = false;
  let unknown = false;
  let lightThreadHover = '';
  const visit = (rules: CSSRuleList): void => {
    for (const rule of rules) {
      if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules);
      if (!('style' in rule) || !('selectorText' in rule)) continue;
      const { style, selectorText } = rule as CSSStyleRule;
      if (selectorText.includes('[light]') && !selectorText.includes('color-version')) {
        lightThreadHover = style.getPropertyValue('--yt-deprecated-general-background-c').trim() || lightThreadHover;
      }
      if (style.getPropertyValue('--yt-sys-color-baseline--base-background')) {
        if (selectorText.includes('[light]')) light = true;
        if (selectorText.includes('[dark]')) dark = true;
      }
      for (const property of style) {
        if (/^--t[0-9a-f]{16}$/.test(property) && selectorText.includes(':root')) declared.add(property);
      }
      // CSSOM longhands of a var()-based shorthand can be empty; inspect the
      // serialized declaration as well so new menu/border aliases cannot slip through.
      for (const match of style.cssText.matchAll(/var\(\s*(--t[0-9a-f]{16})\b/g)) {
        if (!YOUTUBE_CHAT_KNOWN_REFERENCES.has(match[1])) unknown = true;
      }
    }
  };
  for (const sheet of sheets) {
    try { visit(sheet.cssRules); } catch { return null; }
  }
  return light && dark && !unknown && lightThreadHover && CSS.supports('color', lightThreadHover)
    && [...YOUTUBE_CHAT_MAPPED_ALIASES].every(alias => declared.has(alias)) ? lightThreadHover : null;
}
