import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chromium, firefox } from 'playwright';

import { bundleModules, playerStylesheets } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';

const BUNDLE = bundleModules([
  "export { renderKbdText, renderShortcutCaps } from './ui/kbd-text';",
  "export { shortcutMarkup } from './ui/shortcut-display';"
], 'KbdText');

declare global {
  interface Window {
    KbdText: {
      renderKbdText(el: HTMLElement, rawText: string): void;
      renderShortcutCaps(container: HTMLElement, stored: string, env: { platform: 'windows' | 'mac' | 'other' }): void;
      shortcutMarkup(stored: string, env: { platform: 'windows' | 'mac' | 'other' }): string;
    };
  }
}

describe('shortcut caps in right-to-left text', () => {
  for (const engine of testEngines()) {
    it(`keep their left-to-right order inside an RTL tooltip in ${engine}`, { timeout: 60_000 }, async t => {
      const context = await sharedTestBrowser(({ chromium, firefox })[engine]).newContext(t);
      const page = await context.newPage();
      await page.setContent('<body dir="rtl"></body>');
      await page.addStyleTag({ content: playerStylesheets().ui });
      await page.evaluate('window.__name = value => value');
      await page.addScriptTag({ content: BUNDLE });
      const order = (stored: string, platform: 'windows' | 'mac', label: string) => page.evaluate(({ stored, platform, label }) => {
        const tooltip = document.createElement('div');
        tooltip.className = 'theater-button-tooltip visible';
        tooltip.dir = 'rtl';
        document.body.append(tooltip);
        const { renderKbdText, shortcutMarkup } = window.KbdText;
        renderKbdText(tooltip, `${label} ${shortcutMarkup(stored, { platform })}`);
        const caps = [...tooltip.querySelectorAll('kbd')];
        const lefts = caps.map(cap => cap.getBoundingClientRect().left);
        tooltip.remove();
        return { text: caps.map(cap => cap.textContent), ascending: lefts.every((left, index) => index === 0 || left > lefts[index - 1]) };
      }, { stored, platform, label });
      // Arabic label; the glyph arrow and the macOS modifiers are the neutral runs that used to reorder.
      assert.deepEqual(await order('Ctrl+ArrowLeft', 'windows', 'ملء الشاشة'), { text: ['Ctrl', '←'], ascending: true });
      assert.deepEqual(await order('Ctrl+Shift+K', 'mac', 'ملء الشاشة'), { text: ['⌃', '⇧', 'K'], ascending: true });
    });
  }
});

describe('shortcut caps in the accessibility tree', () => {
  for (const engine of testEngines()) {
    it(`expose spoken names of glyph caps in ${engine}`, { timeout: 60_000 }, async t => {
      const context = await sharedTestBrowser(({ chromium, firefox })[engine]).newContext(t);
      const page = await context.newPage();
      await page.setContent('<body><div id="caps"></div></body>');
      await page.evaluate('window.__name = value => value');
      await page.addScriptTag({ content: BUNDLE });
      await page.evaluate(() => window.KbdText.renderShortcutCaps(document.getElementById('caps')!, 'Ctrl+Meta+ArrowLeft', { platform: 'mac' }));
      // A bare <kbd> with aria-label has no name in the tree; the role makes the spoken label count.
      // English fallbacks here; localized names travel the same path.
      assert.deepEqual(
        await page.getByRole('img').evaluateAll(caps => caps.map(cap => cap.getAttribute('aria-label'))),
        ['Control', 'Command', 'Left arrow']
      );
      assert.equal(await page.getByRole('img', { name: 'Left arrow', exact: true }).textContent(), '←');
    });
  }
});
