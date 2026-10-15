import assert from 'node:assert/strict';
import { it } from 'node:test';
import { buildSync } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { ownTestBrowser } from '../src/test-utils/test-browser';

const bundle = buildSync({
  stdin: { contents: `import { createChoiceGrid } from './choice-grid';
    let translated = false;
    window.selections = [];
    window.pickers = ['on-focus', 'on-confirm'].map(mode => {
      const grid = document.getElementById(mode);
      const picker = createChoiceGrid(grid, ['a', 'b', 'c'].map(value => ({ value,
        label: () => (translated ? 'Polski ' : 'English ') + value,
        ariaLabel: () => (translated ? 'Wybierz ' : 'Choose ') + value
      })), mode, value => { window.selections.push(mode + ':' + value); picker.render(value); });
      picker.render('a'); return picker;
    });
    window.relabel = () => { translated = true; window.pickers.forEach(picker => picker.render()); };`,
    resolveDir: __dirname, loader: 'ts' },
  bundle: true, write: false, format: 'iife', target: 'es2022'
}).outputFiles[0].text;

for (const [engine, browserType] of Object.entries({ chromium, firefox })) {
  it(`choice grids share selection, roving focus, activation and live relabeling in ${engine}`, { timeout: 30_000 }, async t => {
    const browser = await browserType.launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const page = await browser.newPage();
      await page.setContent('<div id="on-focus" role="radiogroup"></div><div id="on-confirm" role="radiogroup"></div><button id="outside">Outside</button>');
      await page.addScriptTag({ content: bundle });
      for (const mode of ['on-focus', 'on-confirm']) {
        const grid = page.locator(`#${mode}`);
        assert.equal(await grid.locator('[aria-checked=true][tabindex="0"].selected').count(), 1);
        await grid.locator('[data-choice=a]').focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await grid.locator('[data-choice=b]').evaluate(el => el === document.activeElement), true);
        assert.equal(await grid.locator('[tabindex="0"]').count(), 1);
        assert.equal(await grid.locator('[aria-checked=true]').getAttribute('data-choice'), mode === 'on-focus' ? 'b' : 'a');
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
        if (mode === 'on-confirm') {
          await page.locator('#outside').focus();
          assert.equal(await grid.locator('[data-choice=c]').getAttribute('tabindex'), '0', 'Tab returns to committed selection');
        }
      }
      assert.deepEqual(await page.evaluate('window.selections.filter(value => value.startsWith("on-confirm"))'), ['on-confirm:b', 'on-confirm:c']);
      const button = page.locator('#on-focus [data-choice=b]');
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
