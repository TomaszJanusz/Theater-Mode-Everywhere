import { OwnedDom } from './owned-dom';
import type { ChatSurface, ChatTheme } from './types';

/** Owned marker for the active native Twitch palette. */
export const CHAT_THEME_ATTRIBUTE = 'data-theater-chat-theme';

type ForcedTheme = 'light' | 'dark';

const paletteCache = new WeakMap<Document, Partial<Record<ForcedTheme, string>>>();

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
  private timer: number | null = null;

  update(surface: ChatSurface | null, theme: ChatTheme): void {
    // YouTube's current base CSS contains theme-specific static aliases. Its native
    // setter only switches part of the palette; preserve the complete service theme.
    if (!surface || surface.provider !== 'twitch' || theme === 'native') {
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
    this.applyTwitch(surface, theme);
  }

  private applyTwitch(surface: ChatSurface, theme: ForcedTheme): void {
    const doc = surface.root.ownerDocument;
    const paletteClass = twitchPaletteClass(doc, theme);
    if (!paletteClass) return; // Keep native appearance if the service's complete palette is unavailable.
    const otherPalette = twitchPaletteClass(doc, theme === 'dark' ? 'light' : 'dark');
    const portalRoots = [...doc.querySelectorAll<HTMLElement>('.ReactModalPortal, .ReactModal__Overlay, .tw-dialog-layer')];
    const themedRoots = new Set<HTMLElement>([surface.root, ...portalRoots]);
    for (const root of [...themedRoots]) {
      for (const nested of root.querySelectorAll<HTMLElement>('.tw-root--theme-light, .tw-root--theme-dark')) themedRoots.add(nested);
    }
    for (const root of themedRoots) {
      if (otherPalette && root.classList.contains(otherPalette)) this.owned.setClass(root, otherPalette, false);
      this.owned.setClass(root, paletteClass, true);
      this.owned.setClass(root, 'tw-root--theme-light', theme === 'light');
      this.owned.setClass(root, 'tw-root--theme-dark', theme === 'dark');
    }
    // Twitch has literal light/dark descendant rules as well as palette tokens.
    // Retarget their native theme flags along the chat's ancestor chain too.
    // This changes presentation only, never the persisted Twitch preference or React functions.
    for (let parent = surface.root.parentElement; parent; parent = parent.parentElement) {
      if (!parent.matches('.tw-root--theme-light, .tw-root--theme-dark')) continue;
      this.owned.setClass(parent, 'tw-root--theme-light', theme === 'light');
      this.owned.setClass(parent, 'tw-root--theme-dark', theme === 'dark');
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
    this.owned.restoreAll();
    this.surface = null;
    this.theme = 'native';
  }
}

/** Select the service's complete CSS token class; never reconstruct or hardcode a palette. */
function twitchPaletteClass(doc: Document, theme: ForcedTheme): string | null {
  let cached = paletteCache.get(doc);
  if (!cached) { cached = {}; paletteCache.set(doc, cached); }
  if (cached[theme]) return cached[theme] ?? null;
  const candidates = [...doc.querySelectorAll(`.tw-root--theme-${theme}`)];
  for (const sheet of doc.styleSheets) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    const found = findPaletteClass(rules, candidates, theme);
    if (found) { cached[theme] = found; return found; }
  }
  return null;
}

function findPaletteClass(rules: CSSRuleList, candidates: Element[], theme: ForcedTheme): string | null {
  for (const rule of rules) {
    if ('cssRules' in rule) {
      const nested = findPaletteClass((rule as CSSGroupingRule).cssRules, candidates, theme);
      if (nested) return nested;
    }
    if (!('style' in rule) || !('selectorText' in rule)) continue;
    const styleRule = rule as CSSStyleRule;
    const base = styleRule.style.getPropertyValue('--color-background-base').trim();
    if (!base || !styleRule.style.getPropertyValue('--color-background-input')) continue;
    // Generated names are discovered from the current stylesheet, not stored selectors.
    const match = /^\.([\w-]+)(?:\.\1)?$/.exec(styleRule.selectorText.trim());
    if (!match) continue;
    const nativeMatch = candidates.some(element => element.matches(styleRule.selectorText));
    const normalizedBase = base.replace(/\s/g, '');
    const semanticMatch = normalizedBase === (theme === 'light' ? 'var(--color-white)' : 'var(--color-hinted-grey-2)');
    const oppositeBase = theme === 'light' ? 'var(--color-hinted-grey-2)' : 'var(--color-white)';
    if (semanticMatch || (nativeMatch && normalizedBase !== oppositeBase)) return match[1];
  }
  return null;
}
