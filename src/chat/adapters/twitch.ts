import { OwnedDom } from '../owned-dom';
import type { ChatSurface } from '../types';
import type { ChatThemeAdapter, ForcedTheme } from './types';

const paletteCache = new WeakMap<Document, { sheets: CSSStyleSheet[]; counts: number[]; classes: Partial<Record<ForcedTheme, string>> }>();

export class TwitchChatThemeAdapter implements ChatThemeAdapter {
  private readonly owned = new OwnedDom();
  constructor(private readonly surface: ChatSurface) {}
  apply(theme: ForcedTheme): boolean {
    const surface = this.surface;
    const doc = surface.root.ownerDocument;
    const paletteClass = twitchPaletteClass(doc, theme);
    if (!paletteClass) { this.restore(); return false; }
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
    return true;
  }

  restore(): void { this.owned.restoreAll(); }
}

/** Select the service's complete CSS token class; never reconstruct or hardcode a palette. */
function twitchPaletteClass(doc: Document, theme: ForcedTheme): string | null {
  const sheets = [...doc.styleSheets];
  const counts = sheets.map(sheet => { try { return sheet.cssRules.length; } catch { return -1; } });
  let cached = paletteCache.get(doc);
  if (!cached || sheets.length !== cached.sheets.length || sheets.some((sheet, i) => sheet !== cached!.sheets[i] || counts[i] !== cached!.counts[i])) {
    cached = { sheets, counts, classes: {} };
    paletteCache.set(doc, cached);
  }
  if (cached.classes[theme]) return cached.classes[theme] ?? null;
  const candidates = [...doc.querySelectorAll(`.tw-root--theme-${theme}`)];
  for (const sheet of doc.styleSheets) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    const found = findPaletteClass(rules, candidates, theme);
    if (found) { cached.classes[theme] = found; return found; }
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
