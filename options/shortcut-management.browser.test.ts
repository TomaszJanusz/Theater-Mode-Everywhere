import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

import { chromium, firefox } from 'playwright';

import { installChromeStub } from '../src/test-utils/chrome-stub';
import { bundleModules } from '../src/test-utils/player-boot';
import { readStylesheet } from '../src/test-utils/styles';
import { sharedTestBrowser } from '../src/test-utils/test-browser';
import { testEngines } from '../src/test-utils/test-engines';
import { defaultShortcuts } from '../src/ui/shortcuts';

const html = readFileSync(new URL('./options.html', import.meta.url), 'utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
const css = readStylesheet(new URL('./options.css', import.meta.url));
const bundle = bundleModules(["export { createShortcutEditor } from '../options/shortcut-editor';"]);
const conflicting = { ...defaultShortcuts, toggleMute: 'F', toggleFullscreen: 'F' };

for (const engine of testEngines()) {
  const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
  it(`${engine}: shortcut conflicts stay visible on focus, Tab escapes recording and Escape is reserved`, { timeout: 30_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await page.setContent(html);
    await page.addStyleTag({ content: css });
    await page.locator('#shortcuts').evaluate(section => { (section as HTMLElement).hidden = false; });
    await installChromeStub(page, { sync: { shortcuts: conflicting } });
    await page.addScriptTag({ content: bundle });
    await page.evaluate(`(() => {
      const editor = TheaterTest.createShortcutEditor(async () => {});
      window.shortcutFixture = {
        start: () => editor.initialize(),
        reset: () => { const shortcuts = ${JSON.stringify(defaultShortcuts)}; chrome.storage.sync.set({ shortcuts }); editor.applyStored(shortcuts); }
      };
    })()`);
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

const recordingBundle = bundleModules([
  "export { createShortcutEditor } from '../options/shortcut-editor';",
  "export { createShortcutUpdateQueue } from './ui/shortcut-updates';",
  "export { withShortcutDefaults } from './ui/shortcuts';"
]);

// Chromium reports the layout through `navigator.keyboard`; this AZERTY map is a stub, not a real OS layout.
// Firefox has no layout map, so it keeps the QWERTY legend.
for (const engine of testEngines()) {
  const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
  for (const [platform, expected] of [
    ['Win32', { cycle: 'Shift+T', chat: 'Alt+R', recorded: 'Ctrl+Shift+K' }],
    ['MacIntel', { cycle: '⇧T', chat: '⌥R', recorded: '⌃⇧K' }]
  ] as const) {
    it(`${engine} on ${platform}: shortcut fields show keycap legends while the stored values stay as recorded`, { timeout: 30_000 }, async t => {
      const page = await (await shared.newContext(t)).newPage();
      await page.setContent(html);
      await page.addStyleTag({ content: css });
      await page.locator('#shortcuts').evaluate(section => { (section as HTMLElement).hidden = false; });
      await page.evaluate(`(() => {
        document.documentElement.dir = 'rtl';
        Object.defineProperty(Navigator.prototype, 'platform', { configurable: true, get: () => ${JSON.stringify(platform)} });
        Object.defineProperty(Navigator.prototype, 'userAgentData', { configurable: true, get: () => undefined });
        if (${JSON.stringify(engine)} === 'chromium') Object.defineProperty(Navigator.prototype, 'keyboard', { configurable: true,
          get: () => ({ getLayoutMap: async () => new Map([['KeyW', 'z'], ['KeyA', 'q'], ['KeyQ', 'a']]) }) });
      })()`);
      await installChromeStub(page, { sync: { shortcuts: defaultShortcuts } });
      await page.addScriptTag({ content: recordingBundle });
      await page.evaluate(`(() => {
        const queue = TheaterTest.createShortcutUpdateQueue({
          read: async () => TheaterTest.withShortcutDefaults((await chrome.storage.sync.get('shortcuts')).shortcuts),
          write: shortcuts => chrome.storage.sync.set({ shortcuts })
        });
        chrome.runtime.sendMessage = async message => queue.apply(message.request);
        const editor = TheaterTest.createShortcutEditor(async () => {});
        chrome.storage.onChanged.addListener(changes => { if (changes.shortcuts) editor.applyStored(changes.shortcuts.newValue); });
        return editor.initialize();
      })()`);
      const field = (id: string) => page.locator(`#shortcut-${id}`);
      const stored = () => page.evaluate(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts as Record<string, string>);
      const shows = (id: string, value: string) => page.waitForFunction(([id, value]) =>
        (document.getElementById(`shortcut-${id}`) as HTMLInputElement).value === value, [id, value] as const);
      const qwerty = engine === 'firefox';

      await shows('seek-back', '←');
      for (const [id, value] of [['play-pause', 'Space'], ['exit', 'Esc'], ['volume-up', '↑'], ['cycle', expected.cycle],
        ['toggle-chat', expected.chat], ['navigate-up', qwerty ? 'W' : 'Z'], ['navigate-left', qwerty ? 'A' : 'Q']] as const)
        assert.equal(await field(id).inputValue(), value, id);
      assert.equal(await field('seek-back').evaluate(input => getComputedStyle(input).direction), 'ltr', 'keys read left to right in RTL');

      await field('toggle-mute').press('Control+Shift+KeyK');
      await shows('toggle-mute', expected.recorded);
      await page.waitForFunction(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts.toggleMute === 'Ctrl+Shift+K');

      await field('navigate-up').press('KeyQ');
      await shows('navigate-up', qwerty ? 'Q' : 'A');
      await page.waitForFunction(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts.navigateUp === 'KeyQ');

      // A conflict names the key by its legend; keeping the assignment restores the field.
      await field('toggle-captions').press('ArrowLeft');
      const dialog = page.locator('.te-dialog-overlay');
      await dialog.waitFor();
      assert.match(await dialog.innerText(), /←/);
      assert.doesNotMatch(await dialog.innerText(), /ArrowLeft/);
      await dialog.locator('.te-dialog-btn-secondary').click();
      await dialog.waitFor({ state: 'detached' });
      await shows('toggle-captions', 'C');

      await field('toggle-fullscreen').press('Space');
      await dialog.waitFor();
      assert.match(await dialog.innerText(), /Space/);
      await dialog.locator('.te-dialog-btn-primary').click();
      await dialog.waitFor({ state: 'detached' });
      await shows('toggle-fullscreen', 'Space');
      await shows('play-pause', '');

      const saved = await stored();
      assert.deepEqual({ toggleMute: saved.toggleMute, navigateUp: saved.navigateUp, toggleCaptions: saved.toggleCaptions, toggleFullscreen: saved.toggleFullscreen, playPause: saved.playPause, seekBack: saved.seekBack },
        { toggleMute: 'Ctrl+Shift+K', navigateUp: 'KeyQ', toggleCaptions: 'C', toggleFullscreen: 'Space', playPause: '', seekBack: 'ArrowLeft' });
    });
  }
}
