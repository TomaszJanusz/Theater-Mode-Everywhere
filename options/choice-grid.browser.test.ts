import assert from 'node:assert/strict';
import { it } from 'node:test';

import { chromium, firefox } from 'playwright';

import { bundleModules } from '../src/test-utils/player-boot';
import { sharedTestBrowser } from '../src/test-utils/test-browser';
import { testEngines } from '../src/test-utils/test-engines';

const bundle = bundleModules([`import { createChoiceGrid } from '../options/choice-grid';
    let translated = false;
    window.selections = [];
    const grid = document.getElementById('accent');
    const picker = createChoiceGrid(grid, ['a', 'b', 'c'].map(value => ({ value,
      label: () => (translated ? 'Polski ' : 'English ') + value,
      ariaLabel: () => (translated ? 'Wybierz ' : 'Choose ') + value
    })), value => { window.selections.push(value); picker.render(value); });
    picker.render('a');
    window.relabel = () => { translated = true; picker.render(); };`]);

for (const engine of testEngines()) {
  const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
  it(`choice grids share accent selection, roving focus and live relabeling in ${engine}`, { timeout: 30_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
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
  });
}
