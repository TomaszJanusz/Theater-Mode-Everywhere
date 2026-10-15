import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { buildSync } from 'esbuild';
import { chromium } from 'playwright';
import { ownTestBrowser } from './test-utils/test-browser';

const bundle = buildSync({
  stdin: { contents: `export { buildWhatsNewContent, WHATS_NEW_CONTENT } from './src/whatsNew-content';
    export { openWhatsNewDialog } from './src/whatsNew';
    export { languageRuntime } from './src/i18n-runtime';`,
    resolveDir: new URL('../', import.meta.url).pathname, loader: 'ts' },
  bundle: true, write: false, format: 'iife', globalName: 'Announcement', target: 'es2022'
}).outputFiles[0].text;
const catalogs = Object.fromEntries(['en', 'pl', 'ar'].map(locale => [locale,
  JSON.parse(readFileSync(new URL(`../_locales/${locale}/messages.json`, import.meta.url), 'utf8'))
]));

it('renders static English semantic content safely and refreshes localized dialog labels in place', { timeout: 30_000 }, async t => {
  const browser = await chromium.launch(); ownTestBrowser(t, browser);
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body><button id="opener">Open</button></body></html>');
    await page.evaluate('window.__name = value => value');
    await page.evaluate(catalogs => {
      Object.assign(window, { chrome: { runtime: { sendMessage: async ({ locale }: { locale: string }) => catalogs[locale] } } });
      // Any HTML parsing in the announcement/dialog renderer fails this regression.
      Object.defineProperty(Element.prototype, 'innerHTML', { set() { throw new Error('HTML parsing is forbidden'); } });
    }, catalogs);
    await page.addScriptTag({ content: bundle });
    await page.locator('#opener').focus();
    await page.evaluate('void Announcement.openWhatsNewDialog()');
    await page.getByRole('dialog').waitFor();
    const root = page.locator('.whats-new-content');
    assert.equal(await root.getAttribute('lang'), 'en');
    assert.equal(await root.getAttribute('dir'), 'ltr');
    assert.equal(await root.locator('h3 strong').textContent(), 'Here is Theater Mode Everywhere 1.6!');
    assert.equal(await root.locator(':scope > p').first().textContent(), "I'm delighted to announce that this is the biggest update of this extension so far. The new version brings a more comfortable theater mode, new controls, more supported services within Rich Theater Experience, and performance improvements.");
    assert.equal(await root.locator(':scope > p strong').textContent(), 'biggest update');
    assert.deepEqual(await root.locator('ul > li').allTextContents(), [
      'New services in Rich Theater Experience: Support for the unique features of Bilibili, Bilibili.tv, Tencent Video / WeTV, Crunchyroll and Netflix 🥳',
      'RTE chat support: Using Theater Mode Everywhere no longer means saying goodbye to the YouTube and Twitch chats. You can show them beside the video or below it, and slide the chat panel out or hide it.',
      'Captions under the video: Choose a centered or raised picture. If you choose the latter, the video moves to the top and TME tries to use the space below it to display captions.',
      'Pinnable TME bar: Keep the controls visible, go to the previous or next video, and check the title in the player.',
      'Rich Theater Experience: Support for skip buttons, playing the next episodes and skipping ads on YouTube, Vimeo, Netflix, Disney+, Bilibili, Bilibili.tv, Tencent Video / WeTV and Crunchyroll;',
      'Rich Theater Experience: You can turn RTE on or off for individual sites.',
      'Audio effects: Adjust dialogue, loud sounds, bass and volume in the player settings. Available for all content that is not protected by DRM.',
      'The titles of the videos being played are displayed.',
      'You can go to the home page of the service the video is playing on.',
      'Theater Mode Everywhere should now use fewer resources.',
      'The player now has a dedicated settings menu.',
      'A clearer layout of the extension\'s settings page; a new "About" page has been added.',
      'You can change the language, and the translations have been improved.'
    ]);
    assert.deepEqual(await root.locator('li strong').allTextContents(), ['New services in Rich Theater Experience', 'RTE chat support', 'Captions under the video:', 'Pinnable TME bar', 'Rich Theater Experience', 'Rich Theater Experience', 'Audio effects:']);
    assert.equal(await root.locator('p em').textContent(), 'Thank you to liango2 for the idea of the always-visible interface and to Denis for the idea of automatically entering theater mode.');
    await page.locator('.te-dialog-btn-primary').focus();
    await page.keyboard.press('Tab');
    assert.equal(await root.evaluate(el => el === document.activeElement), true, 'scroll area is in the focus loop');
    const englishBody = await root.textContent();
    for (const locale of ['pl', 'ar', 'en']) {
      await page.evaluate(`Announcement.languageRuntime.set('${locale}')`);
      assert.equal(await page.locator('.te-dialog-title').textContent(), catalogs[locale].whatsNewDialogTitle.message);
      assert.equal(await page.locator('.te-dialog-btn-primary').textContent(), catalogs[locale].dialogAcknowledge.message);
      assert.equal(await root.textContent(), englishBody);
    }
    // Even HTML-like text can only become text nodes; the renderer has no HTML sink.
    const payload = '<script>throw new Error("injected")</script><img src=x onerror=alert(1)>';
    const safe = await page.evaluate(payload => {
      const api = (window as unknown as { Announcement: {
        WHATS_NEW_CONTENT: { heading: string }; buildWhatsNewContent(): HTMLElement;
      } }).Announcement;
      api.WHATS_NEW_CONTENT.heading = payload;
      const content = api.buildWhatsNewContent();
      return { heading: content.querySelector('h3')?.textContent, injected: content.querySelectorAll('script, img').length };
    }, payload);
    assert.deepEqual(safe, { heading: payload, injected: 0 });
    await page.locator('.te-dialog-btn-primary').click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#opener').evaluate(el => el === document.activeElement), true);
  } finally { await browser.close(); }
});
