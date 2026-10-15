import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { buildSync } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { ownTestBrowser } from '../src/test-utils/test-browser';

const css = readFileSync(path.join(__dirname, 'options.css'), 'utf8').replace(/^@import.*$/m, '');
const bundle = buildSync({
  stdin: { contents: `import { createCombobox } from './combobox';
    import { LANGUAGES } from '../src/language';
    window.changes = [];
    window.picker = createCombobox(document.getElementById('language'), [
      { value: 'automatic', label: () => 'Automatic (browser language)' },
      ...LANGUAGES.map(({ locale, name }) => ({ value: locale, label: () => name,
        lang: locale.replace('_', '-'), dir: locale === 'ar' ? 'rtl' : 'ltr' }))
    ], value => { window.changes.push(value); window.picker.render(value); });
    window.picker.render('automatic');`, resolveDir: __dirname, loader: 'ts' },
  bundle: true, write: false, format: 'iife', target: 'es2022'
}).outputFiles[0].text;

for (const [engine, browserType] of Object.entries({ chromium, firefox })) {
  it(`select-only combobox keeps focus, separates browsing from selection and owns popup lifecycle in ${engine}`, { timeout: 30_000 }, async t => {
    const browser = await browserType.launch({ headless: true });
    ownTestBrowser(t, browser);
    try {
      const page = await browser.newPage({ viewport: { width: 480, height: 420 } });
      page.setDefaultTimeout(5000);
      await page.setContent(`<div role="tabpanel" id="panel"><p id="label">Language</p><p id="description" class="visually-hidden">Choose a language</p>
        <button type="button" id="language" class="choice-combobox" aria-labelledby="label" aria-describedby="description"></button>
        <button id="next" style="position:fixed;top:0;right:0">Next</button></div>`);
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: bundle });
      const combo = page.getByRole('combobox', { name: 'Language' });
      const list = page.getByRole('listbox');
      const active = () => combo.evaluate(el => document.getElementById(el.getAttribute('aria-activedescendant') ?? '')?.textContent);
      const focused = () => combo.evaluate(el => el === document.activeElement);
      const closed = async () => {
        assert.equal(await combo.getAttribute('aria-expanded'), 'false');
        assert.equal(await combo.getAttribute('aria-activedescendant'), null);
        assert.equal(await list.count(), 0);
      };
      assert.equal(await combo.getAttribute('aria-haspopup'), 'listbox');
      assert.equal(await combo.getAttribute('aria-controls'), 'language-listbox');
      assert.equal(await combo.getAttribute('aria-describedby'), 'description');
      await closed();
      for (const key of ['Enter', 'Space', 'ArrowDown', 'ArrowUp']) {
        await combo.press(key);
        assert.equal(await combo.getAttribute('aria-expanded'), 'true');
        assert.equal(await active(), 'Automatic (browser language)');
        assert.equal(await focused(), true);
        await combo.press('Escape');
        await closed();
      }
      await combo.press('ArrowDown');
      await combo.press('ArrowDown');
      assert.equal(await active(), 'English');
      assert.equal(await list.getByRole('option', { selected: true }).textContent(), 'Automatic (browser language)');
      await combo.press('End');
      assert.equal(await active(), 'العربية');
      assert.equal(await list.evaluate(el => el.scrollTop > 0), true, 'active option is scrolled into view');
      await combo.press('Home');
      assert.equal(await active(), 'Automatic (browser language)');
      await combo.press('p');
      await combo.press('o');
      assert.equal(await active(), 'Polski');
      await combo.press('Enter');
      await closed();
      assert.equal(await combo.textContent(), 'Polski');
      assert.equal(await focused(), true);
      await combo.press('p');
      assert.equal(await active(), 'Português (Brasil)');
      await combo.press('p');
      assert.equal(await active(), 'Polski', 'repeated letters cycle matches');
      await combo.press('Escape');
      assert.deepEqual(await page.evaluate('window.changes'), ['pl']);
      await combo.click();
      await list.getByRole('option', { name: 'العربية', exact: true }).hover();
      assert.equal(await active(), 'العربية');
      await list.getByRole('option', { name: 'العربية', exact: true }).click();
      assert.equal(await focused(), true);
      assert.equal(await combo.textContent(), 'العربية');
      await closed();
      await combo.press('Enter');
      await combo.press('Home');
      await combo.press('Space');
      assert.equal(await combo.textContent(), 'Automatic (browser language)');
      await combo.press('Enter');
      await combo.press('End');
      await combo.press('Tab');
      await closed();
      assert.equal(await page.locator('#next').evaluate(el => el === document.activeElement), true);
      assert.equal(await combo.textContent(), 'Automatic (browser language)', 'Tab does not commit browsing');
      await combo.click();
      await page.locator('#next').click();
      await closed();
      await combo.click();
      await page.evaluate('window.picker.render("pl")');
      await closed();
      assert.equal(await combo.textContent(), 'Polski', 'external updates close and relabel');
      await combo.click();
      await page.setViewportSize({ width: 380, height: 420 });
      await page.waitForFunction(() => document.getElementById('language')!.getAttribute('aria-expanded') === 'false');
      await combo.click();
      await page.evaluate(() => document.dispatchEvent(new Event('scroll')));
      await closed();
      await combo.click();
      await page.locator('#panel').evaluate((el: HTMLElement) => { el.hidden = true; });
      await page.waitForFunction(() => document.getElementById('language')!.getAttribute('aria-expanded') === 'false');
      await page.locator('#panel').evaluate((el: HTMLElement) => { el.hidden = false; });
      // A low RTL trigger flips above and stays inside a narrow viewport.
      await page.evaluate(() => { document.documentElement.dir = 'rtl'; document.getElementById('language')!.style.cssText = 'position:fixed;bottom:12px;right:12px'; });
      await combo.click();
      const triggerBox = (await combo.boundingBox())!;
      const popupBox = (await list.boundingBox())!;
      assert.ok(popupBox.y + popupBox.height < triggerBox.y);
      assert.ok(popupBox.x >= 0 && popupBox.x + popupBox.width <= 380);
      assert.ok(popupBox.width >= triggerBox.width);
      assert.equal(await list.getAttribute('dir'), 'rtl');
      await page.evaluate('window.picker.destroy(); window.picker.destroy()');
      await combo.click();
      await closed();
      assert.equal(await page.locator('#language-listbox').count(), 0);
    } finally { await browser.close(); }
  });
}
