/**
 * The quick search in Settings → Keyboard Shortcuts. Pure: the editor passes each row's localized text and
 * its key words, so the rule is the same for every language, platform and keyboard layout.
 */
import { parseShortcut, shortcutTokens, type ShortcutDisplayEnv } from '../src/ui/shortcut-display';

/** Case- and accent-insensitive form: `Lecture/Pause  ` and `lecture/pause` compare equal. */
export function normalizeSearchText(text: string): string {
  // NFKD also folds full-width letters (ｑ) typed through an IME; ł has no decomposition, so it is folded by hand.
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ł/g, 'l').replace(/\s+/g, ' ').trim();
}

/**
 * Every word a person may type for a stored shortcut: the keycap legends (`⇧`, `←`), their spoken names in the
 * current language (`Shift`, `Left arrow`) and the stored names (`Shift`, `ArrowLeft`), so `shift` also finds `⇧Q` on macOS.
 */
export function shortcutSearchTerms(stored: string, env: ShortcutDisplayEnv): string[] {
  if (!stored) return [];
  const { modifiers, key } = parseShortcut(stored);
  const terms = [...shortcutTokens(stored, env).flatMap(({ text, label }) => [text, label]), ...modifiers, key];
  return [...new Set(terms.flatMap(term => normalizeSearchText(term).split(' ')).filter(Boolean))];
}

export interface ShortcutSearchItem {
  /** Action name and description as shown. */
  text: readonly string[];
  /** `shortcutSearchTerms` of the assigned shortcut; empty when unassigned. */
  keys: readonly string[];
}

/**
 * An empty query matches everything. Otherwise the query matches when it appears in the text, or when every word
 * of it (split at spaces and `+`) starts one of the key words: `alt+p`, `p alt` and `shift` all find Alt+Shift+P.
 */
export function matchesShortcutSearch(query: string, item: ShortcutSearchItem): boolean {
  const needle = normalizeSearchText(query);
  if (!needle) return true;
  if (item.text.some(text => normalizeSearchText(text).includes(needle))) return true;
  const words = needle.split(/[\s+]+/).filter(Boolean);
  // A query of only `+` looks for the plus key itself.
  if (!words.length) words.push('+');
  return words.every(word => item.keys.some(key => key.startsWith(word)));
}
