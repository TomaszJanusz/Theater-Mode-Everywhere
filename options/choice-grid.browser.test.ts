import assert from 'node:assert/strict';
import { it } from 'node:test';
import { buildSync } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { ownTestBrowser } from '../src/test-utils/test-browser';

const bundle = buildSync({
  stdin: { contents: `import { createChoiceGrid } from './choice-grid';
    let translated = false;
    window.selections = [];
    const grid = document.getElementById('accent');
    const picker = createChoiceGrid(grid, ['a', 'b', 'c'].map(value => ({ value,
      label: () => (translated ? 'Polski ' : 'English ') + value,
      ariaLabel: () => (translated ? 'Wybierz ' : 'Choose ') + value
    })), value => { window.selections.push(value); picker.render(value); });
    picker.render('a');
    window.relabel = () => { translated = true; picker.render(); };`,
    resolveDir: __dirname, loader: 'ts' },
  bundle: true, write: false, format: 'iife', target: 'es2022'
}).outputFiles[0].text;

for (const [engine, browserType] of Object.entries({ chromium, firefox })) {
  it(`choice grids share accent selection, roving focus and live relabeling in ${engine}`, { timeout: 30_000 }, async t => {
    const browser = await browserType.launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const page = await browser.newPage();
      await page.setContent('<div id="accent" role="radiogroup"></div>');
      await page.addScriptTag({ content: bundle });
      const grid = page.locator('#accent');
      assert.equal(await grid.locator('[aria-checked=true][tabindex="0"].selected').count(), 1);
      await grid.locator('[data-choice=a]').focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await grid.locator('[data-choice=b]').evaluate(el => el === document.activeElement), true);
      assert.equal(await grid.locator('[tabindex="0"]').count(), 1);
      assert.equal(await grid.locator('[aria-checked=true]').getAttribute('data-choice'), 'b');
      await page.keyboard.press('Space');
      assert.equal(await grid.locator('[aria-checked=true]').getAttribute('data-choice'), 'b');
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      assert.equal(await grid.locator('[aria-checked=true]').getAttribute('data-choice'), 'c');
      await grid.evaluate(el => el.setAttribute('dir', 'rtl'));
      await page.keyboard.press('ArrowRight');
      assert.equal(await grid.locator('[data-choice=b]').evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('ArrowLeft');
      assert.equal(await grid.locator('[data-choice=c]').evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('ArrowDown');
      assert.equal(await grid.locator('[data-choice=a]').evaluate(el => el === document.activeElement), true, 'wraps');
      await page.keyboard.press('Home');
      const button = page.locator('#accent [data-choice=b]');
      await button.click();
      const identity = await button.elementHandle();
      await page.evaluate('window.relabel()');
      assert.equal(await button.textContent(), 'Polski b');
      assert.equal(await button.getAttribute('title'), 'Polski b');
      assert.equal(await button.getAttribute('aria-label'), 'Wybierz b');
      assert.equal(await identity!.evaluate(el => el === document.activeElement && el.isConnected), true);
      assert.equal(await button.getAttribute('aria-checked'), 'true');
    } finally { await browser.close(); }
  });
}
