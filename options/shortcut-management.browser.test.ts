import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { buildSync } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { sharedTestBrowser } from '../src/test-utils/test-browser';
import { testEngines } from '../src/test-utils/test-engines';
import { readStylesheet } from '../src/test-utils/styles';

const html = readFileSync(new URL('./options.html', import.meta.url), 'utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
const css = readStylesheet(new URL('./options.css', import.meta.url));
const bundle = buildSync({
  stdin: { contents: `
    import { createShortcutEditor } from './shortcut-editor';
    import { defaultShortcuts } from '../src/ui/shortcuts';
    let shortcuts = { ...defaultShortcuts, toggleMute: 'F', toggleFullscreen: 'F' };
    window.chrome = { storage: { sync: { get: async () => ({ shortcuts }) } } };
    const editor = createShortcutEditor(async () => {});
    window.shortcutFixture = {
      start: () => editor.initialize(),
      reset: () => { shortcuts = { ...defaultShortcuts }; editor.applyStored(shortcuts); }
    };
  `, resolveDir: new URL('./', import.meta.url).pathname, loader: 'ts' },
  bundle: true, write: false, format: 'iife', target: 'es2022'
}).outputFiles[0].text;

for (const engine of testEngines()) {
  const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
  it(`${engine}: shortcut conflicts stay visible on focus, Tab escapes recording and Escape is reserved`, { timeout: 30_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await page.setContent(html);
    await page.addStyleTag({ content: css });
    await page.locator('#shortcuts').evaluate(section => { (section as HTMLElement).hidden = false; });
    await page.addScriptTag({ content: bundle });
    await page.evaluate('shortcutFixture.start()');
    const assertConflictColor = () => page.waitForFunction(() =>
      ['shortcut-toggle-mute', 'shortcut-toggle-fullscreen'].every(id => {
        const input = document.getElementById(id)!;
        return input.getAttribute('aria-invalid') === 'true' && getComputedStyle(input).borderTopColor === 'rgb(245, 158, 11)';
      }));
    await page.locator('#shortcut-conflict-status').waitFor({ state: 'visible' });
    await assertConflictColor();
    await page.locator('#shortcut-toggle-mute').focus();
    await assertConflictColor();
    await page.evaluate('shortcutFixture.reset()');
    await page.locator('#shortcut-toggle-fullscreen').press('Tab');
    assert.equal(await page.locator('#shortcut-toggle-fullscreen').evaluate(el => el === document.activeElement), false, 'recording must not trap Tab');
    await page.locator('#shortcut-toggle-mute').press('Escape');
    const dialog = page.locator('.te-dialog-overlay');
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /reserved/);
    await dialog.locator('.te-dialog-btn-primary').click();
    await dialog.waitFor({ state: 'detached' });
  });
}
