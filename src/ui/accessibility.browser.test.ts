import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { build, buildSync } from 'esbuild';
import { chromium, firefox, type Page } from 'playwright';
import { ownTestBrowser } from '../test-utils/test-browser';
import { readStylesheet } from '../test-utils/styles';
import { assertLocalized, readCatalog } from '../test-utils/language-audit';
import { WHATS_NEW_RELEASE } from '../whatsNew-release';

const ROOT = path.resolve(__dirname, '../..');
const PLAYER = buildSync({
  stdin: { contents: `export { bootstrapPlayerRuntime } from './ui/player-runtime';
    export { setPlayerUiCss } from './ui/root';
    export { openDialog } from './dialog';
    export { installMainWorldRuntime } from './platform/main-world-runtime';`, resolveDir: path.join(ROOT, 'src'), loader: 'ts' },
  bundle: true, write: false, format: 'iife', globalName: 'AccessibilityFixture', target: 'es2022'
}).outputFiles[0].text;
const OPTIONS = build({
  entryPoints: [path.join(ROOT, 'options/options.ts')],
  bundle: true, write: false, format: 'iife', target: 'es2022',
  plugins: [{ name: 'raw-license', setup(build) {
    build.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }));
    build.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: 'text' }));
  } }]
}).then(result => result.outputFiles![0].text);

async function mockStorage(page: Page): Promise<void> {
  await page.addInitScript({ content: `
    localStorage.setItem('whatsNewAcknowledgedId', '${WHATS_NEW_RELEASE.id}');
    const saved = { keepControlsVisible: true, blacklist: ['example.com', 'second.com'] };
    const changed = [];
    const storage = {
      get: (keys, callback) => { callback?.(saved); return Promise.resolve(saved); },
      set: async values => {
        const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: value }]));
        Object.assign(saved, values);
        changed.forEach(listener => listener(changes, 'sync'));
      }
    };
    Object.defineProperty(window, 'chrome', { configurable: true, value: {
      runtime: { getURL: file => file, sendMessage: async request => (${JSON.stringify({ pl: readCatalog('pl'), ar: readCatalog('ar') })})[request.locale] },
      storage: { sync: storage, onChanged: { addListener: listener => changed.push(listener) } },
      tabs: { query: async () => [] }
    } });
  ` });
}

async function optionsPage(page: Page): Promise<void> {
  await mockStorage(page);
  const html = readFileSync(path.join(ROOT, 'options/options.html'), 'utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
  await page.route('http://accessibility.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://accessibility.test/options');
  await page.addStyleTag({ content: readStylesheet(path.join(ROOT, 'options/options.css')) });
  await page.addScriptTag({ content: await OPTIONS });
  await page.locator('.choice-btn').first().waitFor();
}

async function playerPage(page: Page): Promise<void> {
  await mockStorage(page);
  await page.route('http://accessibility.test/**', route => route.fulfill(route.request().url().endsWith('.webm')
    ? { contentType: 'video/webm', body: readFileSync(path.join(ROOT, 'test/fixtures/vod.webm')) }
    : { contentType: 'text/html', body: '<html lang="ar" dir="rtl"><body><button id="host-button">Host action</button><video src="/vod.webm" muted style="width:640px;height:360px"></video></body></html>' }));
  await page.goto('http://accessibility.test/player');
  await page.addStyleTag({ content: readStylesheet(path.join(ROOT, 'src/content.css')) });
  await page.addScriptTag({ content: PLAYER });
  await page.evaluate(`AccessibilityFixture.setPlayerUiCss(${JSON.stringify(readStylesheet(path.join(ROOT, 'src/ui/shadow.css')))}); AccessibilityFixture.installMainWorldRuntime(); AccessibilityFixture.bootstrapPlayerRuntime();`);
  await page.locator('video').evaluate(async (video: HTMLVideoElement) => {
    const track = video.addTextTrack('subtitles', 'English', 'en');
    track.addCue(new VTTCue(0, 2, 'Fixture captions'));
    await video.play(); video.pause();
  });
  await page.keyboard.press('t');
  await page.locator('.theater-controls-wrapper.visible').waitFor();
}

async function focused(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).evaluate(el => (el.getRootNode() as Document | ShadowRoot).activeElement === el);
}

for (const [engine, browserType] of Object.entries({ chromium, firefox })) {
  describe(`screen-reader contracts in ${engine}`, () => {
    const testPage = async (t: Parameters<typeof ownTestBrowser>[0], run: (page: Page) => Promise<void>) => {
      const browser = await browserType.launch({ headless: true });
      ownTestBrowser(t, browser);
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        page.setDefaultTimeout(8_000);
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await run(page);
        assert.deepEqual(errors, []);
      } finally { await browser.close(); }
    };

    it('names Settings controls, exposes only the selected panel, and owns service disclosure/exclusion focus', { timeout: 30_000 }, async t => {
      await testPage(t, async page => {
        await optionsPage(page);
        assert.match(await page.locator('#settings-tabs').ariaSnapshot(), /tablist "Theater Mode Everywhere - Settings"/);
        assert.match(await page.locator('body').ariaSnapshot(), /heading "Theater Mode Everywhere" \[level=1\]/);
        assert.equal(await page.getByRole('tabpanel').count(), 1);
        await page.locator('#accent-color-grid [aria-checked=true]').focus();
        await page.keyboard.press('ArrowRight');
        assert.match(await page.locator('#accent-color-grid').ariaSnapshot(), /radio "Use Teal as the accent color" \[checked\]/);
        assert.equal(await focused(page, '#accent-color-grid [data-choice=teal]'), true);
        await page.locator('#tab-features').click();
        const service = page.locator('[data-provider="netflix"]');
        const details = service.locator('.rte-details-toggle');
        assert.match(await service.ariaSnapshot(), /switch "Netflix" \[checked\]/);
        await details.press('Enter');
        assert.equal(await details.getAttribute('aria-expanded'), 'true');
        assert.equal(await details.getAttribute('aria-controls'), 'rte-details-netflix');
        await page.locator('#rte-details-netflix').waitFor({ state: 'visible' }); // Height animates; wait for the settled state.
        assert.equal(await details.evaluate(el => el === document.activeElement), true);
        await details.press('Space');
        assert.equal(await details.getAttribute('aria-expanded'), 'false');
        await page.locator('#rte-details-netflix').waitFor({ state: 'hidden' });
        await service.getByRole('switch', { name: 'Netflix' }).press('Space');
        assert.match(await page.locator('#rte-section').ariaSnapshot(), /checkbox "All services" \[checked=mixed\]/);
        await page.locator('#tab-exclusions').click();
        assert.match(await page.locator('#exclusions').ariaSnapshot(), /button "Add website exclusion"/);
        assert.match(await page.locator('#blacklist-container').ariaSnapshot(), /list "Excluded Websites"/);
        await page.locator('#domain-input').fill('invalid');
        await page.getByRole('button', { name: 'Add website exclusion' }).click();
        assert.match(await page.locator('#validation-msg').ariaSnapshot(), /status: Invalid domain or URL format/);
        assert.equal(await page.locator('#domain-input').getAttribute('aria-invalid'), 'true');
        await page.getByRole('button', { name: 'Remove exclusion: example.com', exact: true }).click();
        await page.getByRole('button', { name: 'Remove exclusion: example.com', exact: true }).waitFor({ state: 'detached' });
        assert.equal(await focused(page, '#blacklist-container button'), true);
        assert.match(await page.locator('#blacklist-count').ariaSnapshot(), /status "Excluded Websites: 1"/);
        await page.locator('#tab-shortcuts').click();
        assert.match(await page.locator('#shortcuts').ariaSnapshot(), /textbox "Toggle Theater Mode"/);
        assert.match(await page.locator('#shortcuts').ariaSnapshot(), /button "Reset to default: Toggle Theater Mode"/);
        await page.evaluate(() => chrome.storage.sync.set({ shortcuts: { toggle: 'T', cycle: 'T' } }));
        assert.equal(await page.locator('#shortcut-toggle').getAttribute('aria-invalid'), 'true');
        assert.match(await page.locator('#shortcut-conflict-status').ariaSnapshot(), /status: Some shortcuts are assigned to multiple actions/);
      });
    });

    it('relocalizes player menus, tooltips, HUD and help and retires old caption dialogs', { timeout: 30_000 }, async t => {
      await testPage(t, async page => {
        await playerPage(page);
        await page.keyboard.press('ArrowRight');
        await page.locator('.cc-btn').click();
        await page.locator('.theater-cc-menu-options').click();
        await page.locator('.theater-caption-options-dialog').waitFor();
        for (const locale of ['pl', 'ar']) {
          await page.evaluate(locale => chrome.storage.sync.set({ language: locale }), locale);
          await page.waitForFunction(locale => document.querySelector('#theater-everywhere-ui')?.getAttribute('lang') === locale, locale);
          await page.locator('.theater-caption-options-dialog').waitFor({ state: 'detached' });
          await assertLocalized(page, locale);
          await page.locator('.theater-help-overlay').waitFor({ state: 'detached' });
          await page.locator('.player-settings-btn').click();
          await page.locator('.theater-settings-menu.visible').waitFor();
          await assertLocalized(page, locale);
          await page.locator('.cc-btn').click();
          await page.locator('.theater-cc-menu-options').click();
          await page.locator('.theater-caption-options-dialog').waitFor();
          await assertLocalized(page, locale);
          await page.keyboard.press('Escape');
          await page.locator('.theater-caption-options-dialog').waitFor({ state: 'detached' });
          await page.keyboard.press('h');
          await page.locator('.theater-help-overlay').waitFor();
          await assertLocalized(page, locale);
          if (locale === 'pl') {
            // Keep Help open through the next catalog change; the player restores it.
            await page.evaluate(() => chrome.storage.sync.set({ language: 'ar' }));
            await page.waitForFunction(() => document.querySelector('#theater-everywhere-ui')?.getAttribute('lang') === 'ar');
            await page.locator('.theater-help-overlay').waitFor();
            await assertLocalized(page, 'ar');
          }
          await page.locator('.theater-help-close-btn').click();
        }
        assert.equal(await page.locator('html').getAttribute('dir'), 'rtl', 'the host retains its original direction');
        assert.equal(await page.locator('video').evaluate((video: HTMLVideoElement) => video.paused), true);
      });
    });

    it('exposes player names/values, standard slider keys, and no hidden panel controls', { timeout: 30_000 }, async t => {
      await testPage(t, async page => {
        await playerPage(page);
        const tree = await page.locator('html').ariaSnapshot();
        assert.match(tree, /slider "Playback position"/);
        assert.match(tree, /button "Play"/);
        assert.match(tree, /button "Toggle mute" \[pressed\]/);
        assert.equal(await page.locator('.theater-volume-panel').evaluate((el: HTMLElement) => el.inert), true);
        assert.equal(await page.locator('.theater-speed-panel').evaluate((el: HTMLElement) => el.inert), true);
        assert.equal(await page.locator('#theater-everywhere-ui').getAttribute('lang'), 'en');
        if (engine === 'chromium') {
          const cdp = await page.context().newCDPSession(page);
          const { nodes } = await cdp.send('Accessibility.getFullAXTree');
          assert.equal(nodes.some(node => !node.ignored && node.role?.value === 'slider' && node.name?.value === 'Volume'), false);
          assert.equal(nodes.some(node => !node.ignored && node.role?.value === 'slider' && node.name?.value === 'Playback position'), true);
          await cdp.detach();
        }
        await page.locator('.theater-scrubber-container').focus();
        await page.keyboard.press('End');
        assert.equal(await page.locator('.theater-scrubber-container').getAttribute('aria-valuetext'), '2 seconds / 2 seconds');
        assert.equal(await page.locator('.theater-scrubber-container').getAttribute('aria-valuenow'), '2');
        if (engine === 'chromium') {
          const cdp = await page.context().newCDPSession(page);
          const { nodes } = await cdp.send('Accessibility.getFullAXTree');
          const slider = nodes.find(node => !node.ignored && node.role?.value === 'slider' && node.name?.value === 'Playback position');
          assert.equal(slider?.value?.value, 2);
          await cdp.detach();
        }
        await page.keyboard.press('Home');
        assert.equal(await page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime), 0);
        await page.locator('.volume-btn').focus();
        assert.match(await page.locator('html').ariaSnapshot(), /slider "Volume": "0"/);
        await page.locator('.theater-volume-slider').focus();
        await page.keyboard.press('ArrowUp');
        assert.equal(await page.locator('video').evaluate((video: HTMLVideoElement) => video.volume), 0.05);
        assert.match(await page.locator('.theater-volume-slider').ariaSnapshot(), /slider "Volume": "0.05"/);
        assert.equal(await page.locator('.theater-volume-slider').getAttribute('aria-valuetext'), '5%');
        await page.keyboard.press('Escape');
        assert.equal(await focused(page, '.volume-btn'), true);
        assert.equal(await page.locator('.theater-volume-panel').evaluate((el: HTMLElement) => el.inert), true);
        await page.keyboard.press('Space');
        assert.equal(await page.locator('video').evaluate((video: HTMLVideoElement) => video.muted), true);
        await page.locator('.speed-btn').focus();
        await page.locator('.theater-speed-slider').focus();
        await page.keyboard.press('ArrowUp');
        assert.match(await page.locator('.theater-speed-slider').ariaSnapshot(), /slider "Playback speed": "4"/);
        assert.equal(await page.locator('.theater-speed-slider').getAttribute('aria-valuetext'), '1.25x');
        await page.keyboard.press('Escape');
        await page.locator('.play-pause-btn').focus();
        await page.keyboard.press('Enter');
        await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
      });
    });

    it('lets a second Escape leave theater after the slider panel has been closed with Escape', { timeout: 30_000 }, async t => {
      await testPage(t, async page => {
        await playerPage(page);
        await page.locator('.volume-btn').focus();
        await page.locator('.theater-volume-slider').focus();
        await page.keyboard.press('Escape');
        assert.equal(await focused(page, '.volume-btn'), true);
        assert.equal(await page.locator('.theater-volume-panel').evaluate((el: HTMLElement) => el.inert), true);
        assert.equal(await page.locator('#theater-everywhere-ui').count(), 1, 'the first Escape only closes the panel');
        await page.keyboard.press('Escape');
        await page.locator('#theater-everywhere-ui').waitFor({ state: 'detached' });
      });
    });

    it('announces a repeated identical status message again by clearing the region first', { timeout: 30_000 }, async t => {
      await testPage(t, async page => {
        await playerPage(page);
        const text = () => page.evaluate(() => document.querySelector('#theater-everywhere-ui')!.shadowRoot!.getElementById('theater-announcements')!.textContent ?? '');
        await page.locator('.play-pause-btn').focus();
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(() => (document.querySelector('#theater-everywhere-ui')!.shadowRoot!.getElementById('theater-announcements')!.textContent ?? '') !== '');
        const first = await text();
        const sequence = await page.evaluate(async () => {
          const status = document.querySelector('#theater-everywhere-ui')!.shadowRoot!.getElementById('theater-announcements')!;
          const seen: string[] = [];
          const observer = new MutationObserver(() => seen.push(status.textContent ?? ''));
          observer.observe(status, { childList: true, subtree: true, characterData: true });
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true }));
          await new Promise(resolve => setTimeout(resolve, 200));
          observer.disconnect();
          return seen;
        });
        assert.equal(sequence[0], '', 'the region is cleared before the repeated message');
        assert.equal(sequence.at(-1), first, 'the latest message is restored afterwards');
      });
    });

    it('uses named caption/settings dialogs, traps modal focus, restores triggers, and limits announcements to feedback', { timeout: 30_000 }, async t => {
      await testPage(t, async page => {
        await playerPage(page);
        await page.locator('.cc-btn').focus();
        await page.keyboard.press('Enter');
        assert.match(await page.locator('.theater-cc-menu').ariaSnapshot(), /dialog "Subtitles"/);
        assert.match(await page.locator('.theater-cc-menu').ariaSnapshot(), /button "Off" \[pressed\]/);
        await page.locator('.theater-cc-menu-options').click();
        const dialog = page.getByRole('dialog', { name: 'Subtitle options' });
        await dialog.waitFor();
        assert.match(await dialog.ariaSnapshot(), /button "Done"/);
        assert.equal(await page.locator('body').evaluate((el: HTMLElement) => el.inert), true);
        assert.equal(await page.locator('.theater-controls-wrapper').evaluate((el: HTMLElement) => el.inert), true);
        await dialog.getByRole('button', { name: 'Done', exact: true }).focus();
        await page.keyboard.press('Tab');
        assert.equal(await focused(page, '.theater-caption-options-dialog .theater-help-close-btn'), true);
        await page.keyboard.press('Shift+Tab');
        assert.equal(await focused(page, '.theater-caption-options-dialog .te-dialog-btn-primary'), true);
        await page.keyboard.press('Escape');
        assert.equal(await focused(page, '.cc-btn'), true);
        await page.locator('.player-settings-btn').focus();
        await page.keyboard.press('Enter');
        assert.match(await page.locator('.theater-settings-menu').ariaSnapshot(), /dialog "Player settings"/);
        // A native select, like the chat theme control, bypasses playback shortcuts.
        await page.locator('.theater-settings-menu').evaluate(panel => {
          const select = document.createElement('select');
          select.id = 'fixture-setting';
          select.setAttribute('aria-label', 'Fixture setting');
          select.add(new Option('Default'));
          panel.append(select);
          select.focus();
        });
        await page.keyboard.press('Escape');
        assert.equal(await focused(page, '.player-settings-btn'), true);
        assert.equal(await page.locator('.theater-settings-menu').evaluate((el: HTMLElement) => el.inert), true);
        await page.locator('#fixture-setting').evaluate(el => el.remove());
        await page.keyboard.press('Enter');
        await page.locator('.help-btn').click();
        assert.match(await page.getByRole('dialog', { name: 'Keyboard Shortcuts' }).ariaSnapshot(), /button "Show\/Hide Help"/);
        await page.keyboard.press('Tab');
        assert.equal(await focused(page, '.theater-help-overlay .theater-help-close-btn'), true);
        await page.locator('.player-settings-btn').focus();
        assert.equal(await focused(page, '.theater-help-overlay .theater-help-close-btn'), true);
        await page.keyboard.press('Escape');
        assert.equal(await focused(page, '.player-settings-btn'), true);
        await page.locator('.play-pause-btn').focus();
        await page.keyboard.press('Shift+L');
        const status = page.locator('#theater-announcements');
        await page.waitForFunction(() => /Raised/.test(document.querySelector('#theater-everywhere-ui')!.shadowRoot!.getElementById('theater-announcements')!.textContent ?? ''));
        assert.match(await status.ariaSnapshot(), /status: Raised/);
        const announcement = await status.textContent();
        await page.locator('video').evaluate((video: HTMLVideoElement) => { video.currentTime = 0.5; video.dispatchEvent(new Event('timeupdate')); });
        assert.equal(await status.textContent(), announcement);
        const mutations = await status.evaluate(status => {
          const observer = new MutationObserver(() => {});
          observer.observe(status, { childList: true, subtree: true, characterData: true });
          document.querySelector('video')!.dispatchEvent(new Event('timeupdate'));
          const count = observer.takeRecords().length;
          observer.disconnect();
          return count;
        });
        assert.equal(mutations, 0, 'ordinary playback updates must not announce');
        await page.keyboard.press('Escape');
        await page.locator('#theater-everywhere-ui').waitFor({ state: 'detached' });
        assert.equal(await page.locator('#host-button').evaluate((el: HTMLElement) => el.inert), false);
      });
    });

    it('includes content links in the shared dialog focus loop and restores the opener', { timeout: 30_000 }, async t => {
      await testPage(t, async page => {
        await page.setContent('<button id="opener">Open</button>');
        await page.addScriptTag({ content: PLAYER });
        await page.locator('#opener').focus();
        await page.evaluate(`void AccessibilityFixture.openDialog({ title: 'Review', content: (() => { const node = document.createElement('div'); node.innerHTML = '<a href="#details">Details</a><input aria-label="Note">'; return node; })(), actions: { type: 'acknowledge' } });`);
        await page.getByRole('button', { name: 'Got it' }).waitFor();
        await page.waitForFunction(() => document.activeElement?.textContent === 'Got it');
        assert.match(await page.locator('body').ariaSnapshot(), /dialog "Review"/);
        assert.equal(await page.locator('#opener').evaluate((el: HTMLElement) => el.inert), true);
        await page.keyboard.press('Tab');
        assert.equal(await focused(page, '.te-dialog-close'), true);
        await page.keyboard.press('Tab');
        assert.equal(await focused(page, 'a'), true);
        await page.keyboard.press('Shift+Tab');
        assert.equal(await focused(page, '.te-dialog-close'), true);
        await page.keyboard.press('Shift+Tab');
        assert.equal(await focused(page, '.te-dialog-btn-primary'), true);
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        assert.equal(await focused(page, '#opener'), true);
      });
    });
  });
}
