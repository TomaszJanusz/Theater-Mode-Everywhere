import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

import type { Page } from 'playwright';

import { installChromeStub } from '../test-utils/chrome-stub';
import { sharedEngineBrowsers } from '../test-utils/engine-browsers';
import { playerStylesheets } from '../test-utils/player-boot';
import { bundleQueryModules } from '../test-utils/query-bundle';
import { readStylesheet } from '../test-utils/styles';
import { testEngines } from '../test-utils/test-engines';

const ROOT = path.resolve(__dirname, '../..');
const browsers = sharedEngineBrowsers();
const bundle = bundleQueryModules([
  "export { createModal } from './ui/modal';",
  "export { setPlayerUiCss, mountPlayerUi, destroyPlayerUi } from './ui/root';",
  "export { openDialog } from './dialog';",
  "export { openWhatsNewDialog } from './whatsNew';",
  "export { openPrivacyPolicy } from '../options/privacy-policy';",
  "export { createShortcutEditor } from '../options/shortcut-editor';",
  "export { installMainWorldRuntime } from './platform/main-world-runtime';",
  "export { bootstrapPlayerRuntime } from './ui/player-runtime';"
], 'ModalFixture');

async function fixture(page: Page, player = false): Promise<void> {
  await page.route('http://modal.test/**', route => route.fulfill(route.request().url().endsWith('.webm')
    ? { contentType: 'video/webm', body: readFileSync(path.join(ROOT, 'test/fixtures/vod.webm')) }
    : { contentType: 'text/html', body: `<html><body><button id="opener">Open</button>
      <div class="options-body"><div><label for="shortcut-cycle">Switch player</label>
      <input id="shortcut-cycle" class="options-input"><button class="reset-single-btn" data-shortcut="cycle">Reset</button></div></div>
      <video src="/vod.webm" muted style="width:640px;height:360px"></video></body></html>` }));
  await page.goto('http://modal.test/');
  await installChromeStub(page, { sync: { keepControlsVisible: true } });
  await page.evaluate(`window.__name = value => value; window.shortcutResult = { status: 'error' };
    chrome.runtime.sendMessage = async () => window.shortcutResult;`);
  await page.addStyleTag({ content: player ? playerStylesheets().page : readStylesheet(path.join(ROOT, 'options/options.css')) });
  await page.addScriptTag({ content: await bundle });
  await page.evaluate(`ModalFixture.setPlayerUiCss(${JSON.stringify(playerStylesheets().ui)});`);
  if (player) {
    await page.evaluate('ModalFixture.installMainWorldRuntime(); ModalFixture.bootstrapPlayerRuntime();');
    await page.locator('video').evaluate(async (video: HTMLVideoElement) => {
      video.addTextTrack('subtitles', 'English', 'en').addCue(new VTTCue(0, 2, 'Fixture captions'));
      await video.play(); video.pause();
    });
    await page.keyboard.press('t');
    await page.locator('.theater-controls-wrapper').waitFor();
  } else await page.evaluate('ModalFixture.createShortcutEditor(async () => {}).initialize()');
}

async function openFamily(page: Page, family: string): Promise<void> {
  if (family === 'help') await page.keyboard.press('h');
  else if (family === 'captions') {
    await page.locator('.cc-btn').click();
    await page.locator('.theater-cc-menu-options').click();
  } else if (family === 'highlights') await page.evaluate('void ModalFixture.openWhatsNewDialog()');
  else if (family === 'privacy') await page.evaluate('ModalFixture.openPrivacyPolicy()');
  else {
    await page.evaluate(family => {
      Object.assign(window, { shortcutResult: family === 'confirm'
        ? { status: 'conflict', owners: ['playPause'] } : { status: 'error' } });
    }, family);
    await page.locator('#shortcut-cycle').press(family === 'reserved' ? 'Escape' : 'k');
  }
  await page.getByRole('dialog').waitFor();
  await page.getByRole('dialog').evaluate(async el => {
    await Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished));
  });
}

async function shell(page: Page) {
  return page.getByRole('dialog').evaluate(dialog => {
    const parts = [dialog, ...Array.from(dialog.children), dialog.querySelector('.te-dialog-close')!, dialog.querySelector('.te-dialog-title')!];
    const styles = parts.map(el => {
      const style = getComputedStyle(el);
      return Object.fromEntries(['padding', 'margin', 'gap', 'borderRadius', 'borderTopWidth', 'borderTopStyle',
        'borderTopColor', 'borderBottomWidth', 'borderBottomStyle', 'borderBottomColor', 'backgroundColor', 'backgroundImage', 'boxShadow', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight',
        'color', 'justifyContent', 'overflowY', 'scrollbarColor'].map(key => [key, style.getPropertyValue(
          key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`))]));
    });
    return {
      structure: parts.map(el => `${el.tagName}.${el.classList[0]}`),
      header: Array.from(dialog.firstElementChild!.children, el => `${el.tagName}.${el.className}`), styles
    };
  });
}

for (const engine of testEngines()) {
  it(`${engine}: every modal family shares the shell and computed styles in normal and High contrast`, { timeout: 180_000 }, async t => {
    const settings = await (await browsers[engine].newContext(t, { viewport: { width: 1000, height: 850 } })).newPage();
    const player = await (await browsers[engine].newContext(t, { viewport: { width: 1000, height: 850 } })).newPage();
    await fixture(settings); await fixture(player, true);
    for (const mode of ['normal', 'high']) {
      for (const page of [settings, player]) await page.evaluate(mode => {
        const root = document.getElementById('theater-everywhere-ui') ?? document.documentElement;
        root.dataset.contrast = mode;
      }, mode);
      let expected: Awaited<ReturnType<typeof shell>> | undefined;
      for (const family of ['highlights', 'privacy', 'reserved', 'error', 'confirm', 'help', 'captions']) {
        const page = ['help', 'captions'].includes(family) ? player : settings;
        await openFamily(page, family);
        const actual = await shell(page);
        expected ??= actual;
        assert.deepEqual(actual, expected, `${mode}: ${family}`);
        assert.equal(await page.getByRole('dialog').getAttribute('aria-modal'), 'true');
        assert.equal(await page.locator('.te-dialog-title').getAttribute('id'), await page.getByRole('dialog').getAttribute('aria-labelledby'));
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'detached' });
      }
    }
  });

  it(`${engine}: modal cleanup is repeatable, restores scroll/focus/inert, and rejects stale updates`, { timeout: 60_000 }, async t => {
    const page = await (await browsers[engine].newContext(t)).newPage(); page.setDefaultTimeout(8_000); await fixture(page);
    for (const player of [false, true]) {
      await page.locator('#opener').focus();
      await page.evaluate(`document.body.style.setProperty('overflow', 'scroll', 'important');
        window.modalAbort = new AbortController();
        window.modal = ModalFixture.createModal({ title: 'Lifecycle', closeLabel: 'Close', content: 'Body',
          mount: ${player ? 'ModalFixture.mountPlayerUi' : 'undefined'}, signal: modalAbort.signal,
          actions: [{ label: 'Done', kind: 'primary', value: true }] });`);
      assert.equal(await page.locator('#opener').evaluate(el => Boolean(el.closest('[inert]'))), true);
      assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).overflow), 'hidden');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate('modal.closed'), false);
      assert.equal(await page.locator('#opener').evaluate(el => el === document.activeElement), true);
      assert.equal(await page.evaluate(`modal.dispose(); modal.dispose(); modal.update({ title: 'Stale', closeLabel: 'Close', content: 'No' }); modal.isOpen`), false);
      assert.equal(await page.locator('#opener').evaluate((el: HTMLElement) => el.inert), false);
      assert.equal(await page.evaluate(`document.body.style.getPropertyValue('overflow')`), 'scroll');
      assert.equal(await page.evaluate(`document.body.style.getPropertyPriority('overflow')`), 'important');
      assert.equal(await page.locator('.te-dialog-overlay').count(), 0);
      await page.evaluate(`window.modal = ModalFixture.createModal({ title: 'Abort', closeLabel: 'Close', content: 'Body',
        mount: ${player ? 'ModalFixture.mountPlayerUi' : 'undefined'}, signal: modalAbort.signal }); modalAbort.abort();`);
      assert.equal(await page.evaluate('modal.closed'), false);
      assert.equal(await page.locator('.te-dialog-overlay').count(), 0);
      assert.equal(await page.locator('#opener').evaluate((el: HTMLElement) => el.inert), false);
      assert.equal(await page.evaluate('document.body.classList.contains("te-dialog-open")'), false);
      await page.evaluate(`window.modal = ModalFixture.createModal({ title: 'Already aborted', closeLabel: 'Close', content: '', signal: modalAbort.signal });`);
      assert.equal(await page.evaluate('modal.isOpen'), false);
      assert.equal(await page.locator('.te-dialog-overlay').count(), 0);
    }
    await page.locator('#opener').focus();
    // Replacement owns exactly one trap/lock; an old disposer cannot release the new one.
    await page.evaluate(`window.modal = ModalFixture.createModal({ title: 'Old', closeLabel: 'Close', content: '' });
      window.replacement = ModalFixture.createModal({ title: 'New', closeLabel: 'Close', content: '' }); modal.dispose();`);
    await page.evaluate(`window.stale = ModalFixture.createModal({ title: 'Stale request', closeLabel: 'Close', content: '', signal: modalAbort.signal });`);
    assert.equal(await page.evaluate('stale.isOpen'), false);
    assert.equal(await page.locator('.te-dialog-title').textContent(), 'New', 'an already-aborted request leaves the current modal alone');
    assert.equal(await page.locator('.te-dialog-overlay').count(), 1);
    assert.equal(await page.locator('#opener').evaluate(el => Boolean(el.closest('[inert]'))), true);
    await page.locator('.te-dialog-overlay').click({ position: { x: 2, y: 2 } });
    assert.equal(await page.evaluate('replacement.closed'), false);
    assert.equal(await page.locator('#opener').evaluate(el => el === document.activeElement), true);
    await page.evaluate(`window.modal = ModalFixture.createModal({ title: 'Detached', closeLabel: 'Close', content: '', mount: ModalFixture.mountPlayerUi });
      document.getElementById('theater-everywhere-ui').remove();`);
    await page.waitForFunction('!modal.isOpen');
    assert.equal(await page.locator('#opener').evaluate((el: HTMLElement) => el.inert), false);
    assert.equal(await page.evaluate('document.body.classList.contains("te-dialog-open")'), false);
  });

  it(`${engine}: player modals isolate host keys, retain native actions, and dispose on theater exit`, { timeout: 90_000 }, async t => {
    const page = await (await browsers[engine].newContext(t)).newPage(); page.setDefaultTimeout(8_000); await fixture(page, true);
    // This capture listener is installed after MAIN, as host scripts are at document_start.
    await page.evaluate(`window.hostKeys = []; for (const type of ['keydown','keyup','keypress'])
      window.addEventListener(type, event => hostKeys.push(event.type + ':' + event.key), true);`);
    for (const family of ['help', 'captions']) {
      await openFamily(page, family);
      await page.evaluate('hostKeys.length = 0');
      if (family === 'help') {
        await page.keyboard.press('h');
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        assert.deepEqual(await page.evaluate('hostKeys'), [], 'the Help invocation shortcut toggles without reaching the host');
        await openFamily(page, family);
        await page.evaluate('hostKeys.length = 0');
      }
      await page.keyboard.press('k'); await page.keyboard.press('t');
      if (family === 'captions') {
        const slider = page.locator('.theater-caption-size-row input');
        await slider.focus();
        const value = Number(await slider.inputValue());
        await page.keyboard.press('ArrowRight');
        assert.equal(Number(await slider.inputValue()), value + 1, 'native slider input works');
        await page.getByRole('button', { name: 'Reset to default', exact: true }).focus();
        await page.keyboard.press('Enter');
        assert.equal(Number(await slider.inputValue()), value, 'native reset activation works');
      }
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      assert.deepEqual(await page.evaluate('hostKeys'), [], 'including the keyup after Escape closes the modal');
      assert.equal(await page.locator('.theater-controls-wrapper').count(), 1);
      await openFamily(page, family);
      await page.setViewportSize({ width: 375, height: 550 });
      const body = page.locator('.te-dialog-body');
      assert.ok(await body.evaluate(el => el.clientHeight > 0 && el.scrollWidth <= el.clientWidth), 'narrow contents fit the shared scroll region');
      // Programmatic exit through the real toolbar tests teardown while a modal is open.
      await page.locator('.close-btn').evaluate((el: HTMLElement) => el.click());
      await page.locator('.theater-controls-wrapper').waitFor({ state: 'detached' });
      assert.equal(await page.locator('.te-dialog-overlay').count(), 0);
      assert.equal(await page.evaluate('document.body.classList.contains("te-dialog-open")'), false);
      assert.equal(await page.locator('#opener').evaluate((el: HTMLElement) => el.inert), false);
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.keyboard.press('t');
      await page.locator('.theater-controls-wrapper').waitFor();
    }
  });
}
