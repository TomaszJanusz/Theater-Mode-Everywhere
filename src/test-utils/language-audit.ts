import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { compileCatalog, type MessageCatalog } from '../message-catalog';

export function readCatalog(locale: string): MessageCatalog {
  return JSON.parse(readFileSync(path.resolve(__dirname, '../../_locales', locale, 'messages.json'), 'utf8'));
}

/** Audit catalog copy, including hidden tabs, dynamic attributes and player shadow DOM. */
export async function assertLocalized(page: Page, locale: string, selector = 'html'): Promise<void> {
  const english = compileCatalog(readCatalog('en'));
  const translated = compileCatalog(readCatalog(locale));
  // Manifest store metadata is localized separately; the UI keeps the product's brand name.
  const table = [...english].filter(([key, message]) => key !== 'extensionname' && key !== 'extensiondescription' && message !== translated.get(key));
  const collect = ({ table, selector }: { table: [string, string][]; selector: string }) => {
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
    const patterns = table.map(([key, message]) => {
      const parsed = new DOMParser().parseFromString(message, 'text/html');
      const text = normalize(parsed.body.textContent ?? '');
      const pattern = text.split(/\$[1-9]/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+');
      return { key, text, pattern: new RegExp(`^${pattern}(?:: .+)?$`) };
    }).filter(({ text }) => text);
    const found: string[] = [];
    const visit = (element: Element): void => {
      // Endonyms deliberately retain their own language, including English.
      if (element.closest('#language-combobox [lang], #language-combobox-listbox [lang]')) return;
      if (!element.matches('script, style, svg, svg *')) {
        const values = [
          ['text', element.textContent ?? ''],
          ...['title', 'aria-label', 'placeholder'].map(attribute => [attribute, element.getAttribute(attribute) ?? ''])
        ];
        for (const [attribute, value] of values) {
          const text = normalize(value);
          if (!text) continue;
          for (const entry of patterns) {
            if (entry.pattern.test(text)) found.push(`${entry.key}: ${element.tagName.toLowerCase()}#${element.id} ${attribute}=${text}`);
          }
        }
      }
      for (const child of element.children) visit(child);
      if (element.shadowRoot) for (const child of element.shadowRoot.children) visit(child);
    };
    const root = document.querySelector(selector);
    if (!root) throw new Error(`Missing audit root: ${selector}`);
    visit(root);
    return found;
  };
  // Keep tsx's callback-name helper local to this evaluation, including on real host pages.
  const leftovers = await page.evaluate(`(() => { const __name = fn => fn; return (${collect.toString()})(${JSON.stringify({ table, selector })}); })()`);
  assert.deepEqual(leftovers, [], `English catalog copy remains after switching to ${locale}`);
}
