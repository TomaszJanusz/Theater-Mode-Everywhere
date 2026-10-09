import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chromium, firefox } from 'playwright';
import { debuggerPort, installFirefoxAddon } from './firefox-addon.mjs';

const name = process.argv[2] ?? 'chromium';
const engine = name === 'firefox' ? firefox : chromium;
const profile = mkdtempSync(path.join(tmpdir(), 'tme-chat-fixes-'));
const extension = path.resolve(`dist/${name === 'firefox' ? 'firefox' : 'chrome'}-unpacked`);
const port = name === 'firefox' ? await debuggerPort() : null;
const context = await engine.launchPersistentContext(profile, {
  headless: false, viewport: { width: 1440, height: 900 }, locale: 'en-US',
  ...(name === 'firefox' ? {
    args: ['--start-debugger-server', String(port)],
    firefoxUserPrefs: { 'devtools.debugger.remote-enabled': true, 'devtools.debugger.prompt-connection': false,
      'devtools.chrome.enabled': true, 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 }
  } : { args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
    '--disable-blink-features=AutomationControlled', '--no-sandbox'] })
});
const results = { browser: name, url: 'https://www.twitch.tv/hasanabi', at: new Date().toISOString(),
  bundles: Object.fromEntries(['content.js', 'content.css', 'mainWorld.js'].map(file =>
    [file, createHash('sha256').update(readFileSync(path.join(extension, file))).digest('hex')])) };
const output = path.resolve('docs/research/screenshots/current');
mkdirSync(output, { recursive: true });
const page = context.pages()[0];
page.setDefaultTimeout(15000);
try {
  if (port) await installFirefoxAddon(port, extension);
  await page.goto(results.url, { waitUntil: 'domcontentloaded' });
  const consent = page.getByRole('button', { name: /^Reject$/ }).first();
  await consent.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await consent.isVisible()) await consent.click();
  const gate = page.locator('[data-a-target="content-classification-gate-overlay-start-watching-button"]');
  await gate.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await gate.isVisible()) await gate.click();
  await page.locator('[data-test-selector="chat-room-component-layout"]').waitFor();
  if (!await page.evaluate(() => document.documentElement.classList.contains('tw-root--theme-dark'))) {
    await page.getByRole('button', { name: 'User Menu', exact: true }).first().click();
    await page.getByRole('switch').first().click();
    await page.waitForFunction(() => document.documentElement.classList.contains('tw-root--theme-dark'));
    await page.waitForTimeout(500);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-test-selector="chat-room-component-layout"]').waitFor();
  await page.waitForFunction(() => document.documentElement.classList.contains('tw-root--theme-dark'));
  results.darkStartup = await page.evaluate(() => {
    let hasLight = false;
    const visit = rules => { for (const r of rules) {
      if (r.cssRules) visit(r.cssRules);
      if (r.selectorText?.startsWith('.') && r.style?.getPropertyValue('--color-background-base') === 'var(--color-white)'
          && r.style.getPropertyValue('--color-background-input')) hasLight = true;
    } };
    for (const sheet of document.styleSheets) { try { visit(sheet.cssRules); } catch {} }
    return { dark: document.documentElement.classList.contains('tw-root--theme-dark'), hasLight };
  });
  assert.equal(results.darkStartup.hasLight, false);
  const nativeToggle = page.locator('[data-a-target="right-column__toggle-collapse-btn"]');
  await nativeToggle.click();
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.keyboard.press('t');
  await page.locator('.theater-chat-toggle:not([hidden])').waitFor();
  assert.equal(await nativeToggle.isVisible(), false);
  await page.evaluate(() => document.querySelector('video').dispatchEvent(new KeyboardEvent('keydown', {
    key: '®', code: 'KeyR', altKey: true, bubbles: true, cancelable: true
  })));
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-chat-visible'));
  results.openedByOptionR = true;
  await page.locator('.theater-chat-toggle').focus();
  await page.keyboard.press('Alt+R');
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-theater-chat-visible'));
  await page.keyboard.press('Alt+R');
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-chat-visible'));
  results.realAltR = true;
  // Re-show the bar after keyboard work, before trying a pointer interaction.
  await page.mouse.move(200, 120);
  await page.mouse.move(150, 120);
  await page.locator('.theater-controls-wrapper.visible').waitFor();
  await page.locator('.player-settings-btn').click();
  const select = page.locator('.theater-chat-theme-select');
  results.themes = [];
  for (const theme of ['light', 'dark', 'light']) {
    await select.selectOption(theme);
    await page.waitForFunction(t => document.documentElement.getAttribute('data-theater-chat-theme') === t, theme);
    const colors = await page.evaluate(() => {
      const root = document.querySelector('[data-theater-chat]');
      const composer = root.querySelector('[data-a-target="chat-input"], .chat-wysiwyg-input__box');
      const css = getComputedStyle(root);
      return { base: css.getPropertyValue('--color-background-base').trim(),
        text: css.getPropertyValue('--color-text-base').trim(),
        input: css.getPropertyValue('--color-background-input').trim(),
        composer: composer && getComputedStyle(composer).backgroundColor,
        fallback: !document.getElementById('theater-everywhere-ui').shadowRoot.querySelector('.theater-chat-theme-hint').hidden };
    });
    assert.equal(colors.fallback, false);
    results.themes.push({ theme, ...colors });
  }
  assert.notEqual(results.themes[0].base, results.themes[1].base);
  assert.equal(results.themes[0].base, results.themes[2].base);
  const menu = page.locator('.theater-settings-menu');
  const slider = page.locator('.theater-chat-width-slider');
  const before = await menu.boundingBox();
  const track = await slider.boundingBox();
  await page.mouse.move(track.x + track.width / 2, track.y + track.height / 2);
  await page.mouse.down();
  results.drag = [];
  for (const fraction of [.9, .1, .95]) {
    await page.mouse.move(track.x + track.width * fraction, track.y + track.height / 2, { steps: 10 });
    const position = await menu.boundingBox();
    assert.ok(Math.abs(position.x - before.x) < 1);
    results.drag.push({ width: await slider.inputValue(), menuLeft: position.x });
  }
  await page.mouse.up();
  assert.ok(Number(await slider.inputValue()) > 540);
  await select.selectOption('native');
  await page.locator('.player-settings-btn').click();
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
  assert.equal(await nativeToggle.isVisible(), true);
  assert.equal(await page.locator('[data-theater-chat-palette]').count(), 0);
  results.restored = true;
  console.log(JSON.stringify(results));
  writeFileSync(path.join(output, `twitch-chat-fixes-${name}.json`), JSON.stringify(results, null, 2) + '\n');
} catch (error) {
  console.log(JSON.stringify({ ...results, error: String(error) }));
  await page.screenshot({ path: path.join(output, `twitch-chat-fixes-error-${name}.png`) });
  throw error;
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
