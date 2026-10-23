import { WHATS_NEW_ACK_STORAGE_KEY, WHATS_NEW_RELEASE } from '../src/whatsNew-release';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { type BrowserContext, type Page } from 'playwright';

import { fail, extensionWorker, waitForPlayer, theaterEntered, THEATER_VIDEO_CLASS, PARENT_HOST, PARENT_BLACKLIST, ROOT, timeScenario, setBlacklist } from './smoke/helpers';
import { runBrowsers } from './smoke/browsers';
// Legacy real deadlines stay here so moving modules cannot reset their per-file ratchet.
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function assertShortcutManagement(page: Page, context: BrowserContext): Promise<void> {
  return timeScenario('assertShortcutManagement', async () => {
    const worker = await extensionWorker(context);
    await worker.evaluate(async ({ key, id }) => { await chrome.storage.local.set({ [key]: id }); }, { key: WHATS_NEW_ACK_STORAGE_KEY, id: WHATS_NEW_RELEASE.id });
    const options = await context.newPage();
    const second = await context.newPage();
    const screenshot = async (target: Page, suffix: string) => {
      if (process.env.THEATER_SMOKE_SCREENSHOT) await target.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT.replace(/\.png$/, `-${suffix}.png`) });
    };
    try {
      await options.goto(new URL('options/options.html#shortcuts', worker.url()).href);
      // The second tab starts in front; visual transitions need an active page.
      await options.bringToFront();
      await options.waitForSelector('.options-body[aria-busy="false"]');
      await options.locator('#shortcut-toggle-mute').press('f');
      const dialog = options.locator('.te-dialog-overlay');
      await dialog.waitFor();
      await options.waitForFunction(() => document.activeElement?.classList.contains('te-dialog-btn-secondary'));
      await dialog.evaluate(async overlay => { await Promise.all(overlay.getAnimations({ subtree: true }).map(animation => animation.finished)); });
      await screenshot(options, 'shortcut-conflict');
      await options.keyboard.press('Enter'); // Safe initial focus preserves the existing owner.
      await dialog.waitFor({ state: 'detached' });
      if (await options.locator('#shortcut-toggle-mute').inputValue() !== 'M') fail('Cancelling a shortcut conflict changed the assignment.');
      await options.waitForSelector('.options-body[aria-busy="false"]');
      await options.locator('#shortcut-toggle-mute').press('f');
      await dialog.locator('.te-dialog-btn-primary').click();
      await options.waitForFunction(async () => {
        const { shortcuts } = await chrome.storage.sync.get('shortcuts');
        return shortcuts?.toggleMute === 'F' && shortcuts?.toggleFullscreen === '';
      });
      await options.waitForFunction(() => (document.getElementById('shortcut-toggle-fullscreen') as HTMLInputElement).value === '');
      await options.reload();
      await options.waitForSelector('.options-body[aria-busy="false"]');
      if (await options.locator('#shortcut-toggle-fullscreen').inputValue() !== '') fail('Unassigned shortcut reverted to its default on reload.');
      await options.waitForSelector('.options-body[aria-busy="false"]');
      await options.locator('[data-shortcut="toggleFullscreen"]').click();
      await dialog.waitFor();
      await options.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      if (await options.locator('#shortcut-toggle-fullscreen').inputValue() !== '') fail('Single reset bypassed conflict validation.');
      await options.waitForSelector('.options-body[aria-busy="false"]');
      await options.locator('[data-shortcut="toggleFullscreen"]').click();
      await dialog.locator('.te-dialog-btn-primary').click();
      await options.waitForFunction(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts?.toggleFullscreen === 'F');
      await options.waitForSelector('.options-body[aria-busy="false"]');
      await options.locator('#reset-shortcuts-btn').click();
      await options.waitForFunction(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts?.toggleMute === 'M');
      await second.goto(new URL('options/options.html#shortcuts', worker.url()).href);
      await options.waitForSelector('.options-body[aria-busy="false"]');
      await second.waitForSelector('.options-body[aria-busy="false"]');
      await Promise.all([options.locator('#shortcut-toggle-mute').press('Control+M'), second.locator('#shortcut-controls-pin').press('Shift+U')]);
      await options.waitForFunction(async () => {
        const { shortcuts } = await chrome.storage.sync.get('shortcuts');
        return shortcuts?.toggleMute === 'Ctrl+M' && shortcuts?.toggleControlsPin === 'Shift+U';
      });
      // The Navigation group records a key's position, whatever this layout prints there: an AZERTY-style Q on the A position.
      await options.waitForSelector('.options-body[aria-busy="false"]');
      await options.locator('#shortcut-navigate-left').evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', code: 'KeyJ', bubbles: true, cancelable: true })));
      await options.waitForFunction(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts?.navigateLeft === 'KeyJ');
      await options.waitForSelector('.options-body[aria-busy="false"]');
      await options.locator('#reset-shortcuts-btn').click();
      await options.waitForFunction(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts?.navigateLeft === 'KeyA');
      // Live custom entry keys replace their defaults without a reload.
      await options.waitForSelector('.options-body[aria-busy="false"]');
      await options.locator('#shortcut-toggle-fullscreen').press('g');
      await page.waitForFunction(() => document.documentElement.getAttribute('data-theater-everywhere-entry-shortcuts')?.includes('"fullscreen":"G"'));
      await page.bringToFront();
      await page.locator('video#player').click();
      await page.keyboard.press('f');
      if (await theaterEntered(page)) fail('The old fullscreen key still activates TME.');
      await page.keyboard.press('g');
      await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
      await page.locator('.theater-controls-wrapper').waitFor();
      if (await page.evaluate(() => window.hostEntryKeys.includes('KeyG'))) fail('Early host window capture won over the configured fullscreen shortcut.');
      await page.keyboard.down('g');
      await page.keyboard.down('g'); // repeat must be claimed but must not reopen fullscreen.
      await page.keyboard.up('g');
      await page.waitForFunction(() => !document.fullscreenElement);
      await page.keyboard.press('Escape');
      await page.locator('.theater-controls-wrapper').waitFor({ state: 'detached' });
      // Start a fresh document, then prove the custom theater key propagates live.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForPlayer(page);
      await options.waitForSelector('.options-body[aria-busy="false"]');
      await options.locator('#shortcut-toggle').press('Shift+T');
      await dialog.locator('.te-dialog-btn-primary').click(); // Move from Cycle video.
      await options.waitForFunction(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts?.toggle === 'Shift+T');
      await page.waitForFunction(() => document.documentElement.getAttribute('data-theater-everywhere-entry-shortcuts')?.includes('"fullscreen":"G"') && document.documentElement.getAttribute('data-theater-everywhere-entry-shortcuts')?.includes('"toggle":"Shift+T"'));
      await page.bringToFront();
      await page.locator('video#player').click();
      await page.keyboard.press('Shift+T');
      try { await page.locator('.theater-controls-wrapper').waitFor(); } catch (error) {
        console.error('Custom theater diagnostics', await page.evaluate(() => ({ config: document.documentElement.getAttribute('data-theater-everywhere-entry-shortcuts'), classes: document.documentElement.className, active: document.activeElement?.outerHTML, hostKeys: window.hostEntryKeys })));
        throw error;
      }
      await page.keyboard.press('Escape');
      await worker.evaluate(async () => { await chrome.storage.sync.remove('shortcuts'); });
      await page.waitForFunction(() => document.documentElement.getAttribute('data-theater-everywhere-entry-shortcuts')?.includes('"toggle":"T"'));
    } finally {
      await options.close(); await second.close();
    }
    console.log('smoke shortcuts: background conflict cancel/transfer, unbinding, reset, concurrent tabs and live custom fullscreen/theater keys passed');
  });
}

export async function assertBlacklistBlocksTheater(page: Page): Promise<void> {
  return timeScenario('assertBlacklistBlocksTheater', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await page.click('video#player');
    await page.keyboard.press('t');
    await delay(800);
    if (await theaterEntered(page)) fail('Theater mode activated on a blacklisted host.');
    await page.keyboard.press('f');
    if (await theaterEntered(page) || await page.evaluate(() => Boolean(document.fullscreenElement))) fail('Fullscreen captured a key on a blacklisted host.');
    if (await page.evaluate(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'))) fail('Blacklisting retained the early shortcut configuration.');
  });
}

export async function assertIframeHandshake(page: Page, origin: string): Promise<void> {
  return timeScenario('assertIframeHandshake', async () => {
    await page.goto(`${origin}/iframe`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('#child');
    await frame.locator('video#player').click({ timeout: 15_000 });
    await page.keyboard.press('t');
    await page.waitForFunction((videoClass) => {
      const iframe = document.querySelector('#child');
      const childDoc = (iframe as HTMLIFrameElement | null)?.contentDocument;
      const childVideo = childDoc?.querySelector('video#player');
      return Boolean(
        iframe?.classList.contains(videoClass)
        || childVideo?.classList.contains(videoClass)
        || childDoc?.documentElement.classList.contains('theater-everywhere-html-active')
      );
    }, THEATER_VIDEO_CLASS, { timeout: 10_000 });
    await page.waitForFunction(videoClass => document.getElementById('child')?.classList.contains(videoClass), THEATER_VIDEO_CLASS);
    // Make parent focus explicit; a body without tabindex leaves focus in the iframe.
    await page.locator('body').evaluate(body => { body.tabIndex = -1; });
    await page.evaluate(`(() => {
      window.iframeNavigationSpy = { nextReleases: 0, previousReleases: 0, navigation: null };
      document.addEventListener('keyup', event => {
        if (event.code === 'KeyN') window.iframeNavigationSpy.nextReleases++;
        if (event.code === 'KeyP') window.iframeNavigationSpy.previousReleases++;
      });
      window.addEventListener('message', event => {
        if (event.source === document.getElementById('child').contentWindow
            && event.data?.type === 'PLAYLIST_NAV_QUERY') {
          window.iframeNavigationSpy.navigation = event.data.payload;
        }
      });
    })()`);
    await page.locator('body').press('Shift+N');
    await page.locator('body').press('Shift+P');
    const releases = await page.evaluate(`({ next: window.iframeNavigationSpy.nextReleases, previous: window.iframeNavigationSpy.previousReleases })`) as { next: number; previous: number };
    if (releases.next !== 1 || releases.previous !== 1) fail('Unavailable iframe navigation swallowed parent host releases.');
    await frame.locator('body').evaluate(body => {
      const button = document.createElement('button');
      button.id = 'iframe-next';
      button.className = 'vjs-next-video';
      button.textContent = 'Next';
      button.style.cssText = 'position:fixed;left:10px;top:10px;width:50px;height:30px';
      button.dataset.activations = '0';
      button.addEventListener('click', () => { button.dataset.activations = String(Number(button.dataset.activations) + 1); });
      body.appendChild(button);
    });
    await page.waitForFunction(`window.iframeNavigationSpy.navigation?.next === true`);
    await page.locator('body').focus();
    await page.keyboard.down('Shift');
    await page.keyboard.down('n');
    await page.locator('body').dispatchEvent('keydown', { key: 'N', code: 'KeyN', shiftKey: true, repeat: true, bubbles: true, cancelable: true });
    await page.keyboard.up('n');
    await page.keyboard.up('Shift');
    await frame.locator('#iframe-next[data-activations="1"]').waitFor({ state: 'attached' });
    if (await page.evaluate(`window.iframeNavigationSpy.nextReleases`) !== 1) fail('Available iframe navigation leaked a host release.');
    await frame.locator('#iframe-next').evaluate((button: HTMLButtonElement) => { button.disabled = true; });
    await page.waitForFunction(`window.iframeNavigationSpy.navigation?.next === false`);
    await page.locator('body').press('Shift+N');
    if (await page.evaluate(`window.iframeNavigationSpy.nextReleases`) !== 2) fail('Disabled iframe navigation retained its shortcut claim.');
    await frame.locator('#iframe-next').evaluate(button => button.remove());
    // Parent focus in an iframe session must still toggle TME document fullscreen.
    await page.locator('body').press('f');
    await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
    await page.locator('body').press('f');
    await page.waitForFunction(() => !document.fullscreenElement);
    // The layout a session starts in depends on the profile (fresh installs differ from a run that already cycled it): assert the cycle, not its start.
    const layout = frame.locator('.picture-layout-btn .theater-settings-detail');
    const startLayout = await layout.innerText();
    await page.locator('body').press('Shift+L');
    await layout.filter({ hasNotText: startLayout }).waitFor({ state: 'attached' });
    await frame.locator('body').press('Shift+L');
    await layout.filter({ hasText: startLayout }).waitFor({ state: 'attached' });
    // A shortcut focused in the parent must update the child player exactly once.
    await page.locator('body').press('Shift+H');
    await frame.locator('.controls-visibility-toggle[aria-pressed="true"]').waitFor({ state: 'attached' });
    await frame.locator('body').press('Shift+H');
    await frame.locator('.controls-visibility-toggle[aria-pressed="false"]').waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');
    await page.waitForFunction((videoClass) => {
      const iframe = document.querySelector('#child');
      const childDoc = (iframe as HTMLIFrameElement | null)?.contentDocument;
      const childVideo = childDoc?.querySelector('video#player');
      return !iframe?.classList.contains(videoClass)
        && !childVideo?.classList.contains(videoClass)
        && !childDoc?.documentElement.classList.contains('theater-everywhere-html-active');
    }, THEATER_VIDEO_CLASS, { timeout: 10_000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await frame.locator('video#player').click({ timeout: 15_000 });
    await page.waitForFunction(() => document.activeElement === document.getElementById('child'));
    await frame.locator('body').press('t');
    await page.waitForFunction((videoClass) => {
      const iframe = document.querySelector('#child');
      const childDoc = (iframe as HTMLIFrameElement | null)?.contentDocument;
      const childVideo = childDoc?.querySelector('video#player');
      return Boolean(
        iframe?.classList.contains(videoClass)
        || childVideo?.classList.contains(videoClass)
        || childDoc?.documentElement.classList.contains('theater-everywhere-html-active')
      );
    }, THEATER_VIDEO_CLASS, { timeout: 10_000 });
    await frame.locator('.theater-controls-wrapper').waitFor();
    await frame.locator('body').press('Escape');
    await page.waitForFunction((videoClass) => {
      const iframe = document.querySelector('#child');
      const childDoc = (iframe as HTMLIFrameElement | null)?.contentDocument;
      const childVideo = childDoc?.querySelector('video#player');
      return !iframe?.classList.contains(videoClass)
        && !childVideo?.classList.contains(videoClass)
        && !childDoc?.documentElement.classList.contains('theater-everywhere-html-active');
    }, THEATER_VIDEO_CLASS, { timeout: 10_000 });
    // A frame that reloads while the page is in theater drops its session; the page must not stay pinned around it.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await frame.locator('video#player').click({ timeout: 15_000 });
    await frame.locator('body').press('t');
    await page.waitForFunction(videoClass => document.getElementById('child')?.classList.contains(videoClass), THEATER_VIDEO_CLASS, { timeout: 10_000 });
    await page.evaluate(() => (document.getElementById('child') as HTMLIFrameElement).contentWindow?.location.reload());
    await page.waitForFunction((videoClass) => !document.getElementById('child')?.classList.contains(videoClass)
      && !document.documentElement.classList.contains('theater-everywhere-html-active'), THEATER_VIDEO_CLASS, { timeout: 10_000 });
    console.log('smoke iframe child T/Escape passed');
  });
}

export async function assertParentBlacklist(page: Page, origin: string, context: BrowserContext): Promise<void> {
  return timeScenario('assertParentBlacklist', async () => {
    await setBlacklist(context, [PARENT_BLACKLIST]);
    const port = new URL(origin).port;
    await page.goto(`http://${PARENT_HOST}:${port}/`, { waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await page.click('video#player');
    await page.keyboard.press('t');
    await delay(800);
    if (await theaterEntered(page)) {
      fail('Theater mode activated under a parent-domain blacklist.');
    }
  });
}

export async function assertLanguageMenu(page: Page, origin: string, context: BrowserContext): Promise<void> {
  return timeScenario('assertLanguageMenu', async () => {
    const worker = await extensionWorker(context);
    const catalog = (locale: string): Record<string, { message: string }> => JSON.parse(
      readFileSync(path.join(ROOT, '_locales', locale, 'messages.json'), 'utf8'));
    const english = catalog('en');
    const polish = catalog('pl');
    const arabic = catalog('ar');
    await worker.evaluate(({ key, release }) => chrome.storage.local.set({ [key]: release }),
      { key: WHATS_NEW_ACK_STORAGE_KEY, release: WHATS_NEW_RELEASE.id });
    const options = await context.newPage();
    const otherOptions = await context.newPage();
    const popup = await context.newPage();
    try {
      await worker.evaluate(() => chrome.storage.sync.remove('language'));
      await page.goto(`${origin}/`);
      await waitForPlayer(page);
      await page.locator('video#player').click();
      await page.keyboard.press('t');
      await page.locator('.player-settings-btn').waitFor({ state: 'attached' });
      const extensionUrl = new URL('options/options.html#appearance', worker.url()).href;
      await options.setViewportSize({ width: 1280, height: 1100 });
      await options.goto(extensionUrl);
      await otherOptions.goto(extensionUrl);
      await popup.goto(new URL('popup/popup.html', worker.url()).href);
      await popup.locator('#domain-name').filter({ hasText: 'System page' }).waitFor();
      await options.waitForFunction(count => document.querySelectorAll('#language-combobox-listbox [role=option]').length === count, readdirSync(path.join(ROOT, '_locales')).length + 1);
      const combo = options.locator('#language-combobox');
      const list = options.locator('#language-combobox-listbox');
      const openLanguageMenu = async () => {
        await options.bringToFront();
        await combo.scrollIntoViewIfNeeded();
        // Playwright can click before its automatic scroll event is dispatched.
        // Drain that event before opening: the combobox closes on document scroll.
        await options.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
        await combo.click();
        await options.locator('#language-combobox[aria-expanded="true"]').waitFor();
        await list.waitFor();
      };
      // Diagnostic captures only; they follow the same THEATER_SMOKE_SCREENSHOT gate as the other smoke screenshots.
      const languageScreenshot = async (name: string) => {
        if (process.env.THEATER_SMOKE_SCREENSHOT) {
          await options.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT.replace(/\.png$/, `-${name}.png`), fullPage: true, animations: 'disabled' });
        }
      };
      if (await options.locator('#language-combobox-listbox [aria-selected=true]').getAttribute('data-value') !== 'automatic') throw new Error('Language must default to Automatic');
      const before = await page.locator('video#player').evaluate((v: HTMLVideoElement) => ({ paused: v.paused, source: v.currentSrc }));
      await languageScreenshot('lang-dropdown-en');
      await openLanguageMenu();
      await languageScreenshot('lang-combobox-open');
      await options.getByRole('option', { name: 'Polski', exact: true }).click();
      await options.locator('#tab-appearance').filter({ hasText: polish.appearanceTitle.message }).waitFor();
      await otherOptions.waitForFunction(() => document.querySelector('#language-combobox-listbox [aria-selected=true]')?.getAttribute('data-value') === 'pl');
      await popup.locator('[data-i18n="websiteLabel"]').filter({ hasText: polish.websiteLabel.message }).waitFor();
      await page.locator('.player-settings-btn').and(page.getByLabel(polish.playerSettingsLabel.message, { exact: true })).waitFor({ state: 'attached' });
      if (await popup.locator('#domain-name').textContent() !== polish.systemPage.message) throw new Error('Popup dynamic domain state lost its translation');
      await languageScreenshot('lang-dropdown-pl');
      await combo.focus();
      await options.keyboard.press('ArrowDown');
      await options.keyboard.press('End'); // Arabic is the last endonym.
      await options.keyboard.press('Enter');
      await options.waitForFunction(() => document.documentElement.dir === 'rtl' && document.documentElement.lang === 'ar');
      await otherOptions.waitForFunction(() => document.documentElement.dir === 'rtl');
      await popup.waitForFunction(() => document.documentElement.dir === 'rtl');
      await page.locator('.theater-controls-wrapper[dir="rtl"][lang="ar"]').waitFor({ state: 'attached' });
      await page.locator('.player-settings-btn').and(page.getByLabel(arabic.playerSettingsLabel.message, { exact: true })).waitFor({ state: 'attached' });
      await languageScreenshot('lang-dropdown-ar');
      await openLanguageMenu();
      await languageScreenshot('lang-combobox-open-ar');
      await options.keyboard.press('Escape');
      if (process.env.THEATER_SMOKE_SCREENSHOT) {
        await options.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT.replace(/\.png$/, '-language-ar-options.png'), fullPage: true });
        await page.bringToFront();
        await page.locator('.player-settings-btn').press('Enter');
        await page.locator('.theater-settings-menu.visible').waitFor();
        await page.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT.replace(/\.png$/, '-language-ar-player.png') });
      }
      const after = await page.locator('video#player').evaluate((v: HTMLVideoElement) => ({ paused: v.paused, source: v.currentSrc }));
      if (JSON.stringify(before) !== JSON.stringify(after) || !await theaterEntered(page)) throw new Error('Language switch changed playback or exited theater');
      if (await page.locator('html').getAttribute('dir') !== null) throw new Error('Player localization changed host document direction');

      // Saved override on a fresh child document, then a live change back to Automatic.
      await page.goto(`${origin}/iframe`);
      const frame = page.frameLocator('#child');
      await frame.locator('video#player').click();
      await frame.locator('body').press('t');
      await frame.locator('.theater-controls-wrapper[dir="rtl"]').waitFor({ state: 'attached' });
      await combo.focus();
      await options.keyboard.press('ArrowUp');
      await options.keyboard.press('Home');
      await options.keyboard.press('Enter');
      await options.waitForFunction(() => document.documentElement.dir === 'ltr' && document.documentElement.lang.startsWith('en'));
      await otherOptions.waitForFunction(() => document.querySelector('#language-combobox-listbox [aria-selected=true]')?.getAttribute('data-value') === 'automatic');
      await frame.locator('.theater-controls-wrapper[dir="ltr"]').waitFor({ state: 'attached' });
      await frame.locator('.player-settings-btn').and(frame.getByLabel(english.playerSettingsLabel.message, { exact: true })).waitFor({ state: 'attached' });
      await popup.waitForFunction(() => document.documentElement.dir === 'ltr');
      await popup.locator('#status-text').filter({ hasText: english.statusInactiveSystem.message }).waitFor();
      await frame.locator('body').press('Escape');
      await options.locator('#tab-about').click();
      await languageScreenshot('lang-about');
      console.log('smoke:chromium language menu: two Settings pages, popup, player, keyboard selection, saved iframe override, RTL/Automatic restoration and playback preservation passed');
    } finally {
      await worker.evaluate(() => chrome.storage.sync.remove('language'));
      await options.close();
      await otherOptions.close();
      await popup.close();
    }
  });
}

runBrowsers({ assertShortcutManagement, assertBlacklistBlocksTheater, assertIframeHandshake, assertParentBlacklist, assertLanguageMenu }).catch(error => {
  console.error(error);
  process.exit(1);
});
