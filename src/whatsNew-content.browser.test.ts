import { selectTestEngines } from './test-utils/test-engines';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { buildSync } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { ownTestBrowser } from './test-utils/test-browser';
import { readStylesheet } from './test-utils/styles';
import { WHATS_NEW_CONTENT } from './whatsNew-content';

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
    assert.equal(await root.locator('h3 strong').textContent(), WHATS_NEW_CONTENT.heading);
    assert.equal(await root.locator(':scope > p').first().textContent(), "I'm delighted to announce that this is the biggest update of this extension so far. The new version brings a more comfortable theater mode, new controls, more supported services within Rich Theater Experience, and performance improvements.");
    assert.equal(await root.locator(':scope > p strong').textContent(), 'biggest update');
    assert.deepEqual(await root.locator('ul > li').allTextContents(), [
      'New services in Rich Theater Experience: Support for the unique features of Bilibili, Bilibili.tv, Tencent Video / WeTV, Crunchyroll and Netflix 🥳',
      'RTE chat support: Using Theater Mode Everywhere no longer means saying goodbye to the YouTube and Twitch chats. You can show them beside the video or below it, and slide the chat panel out or hide it.',
      'Captions under the video: The picture is raised by default while subtitles are on; you can switch to a centered picture or raise it always. In a raised layout the video moves to the top and TME tries to use the space below it to display captions.',
      'Pin controls: Keep the controls docked flush to the player edges, go to the previous or next video, and check the title in the player.',
      'Rich Theater Experience: Support for skip buttons, playing the next episodes and skipping ads on YouTube, Vimeo, Netflix, Disney+, Bilibili, Bilibili.tv, Tencent Video / WeTV and Crunchyroll;',
      'Rich Theater Experience: You can turn RTE on or off for individual services in Settings → Features, where each service tile lights up in its brand colors, and filter services by capability, including playlists. Playlist and queue navigation is available on YouTube, Vimeo Showcase, Netflix, Disney+, Bilibili, Bilibili.tv and Tencent Video / WeTV when the host provides it.',
      'Audio effects: Adjust dialogue, loud sounds, bass (from Less to MOAAARR!, with a subwoofer that turns red at the top levels) and volume in the player settings, or scroll over the speaker or volume slider. Available for all content that is not protected by DRM.',
      'SponsorBlock support: See markers from your installed SponsorBlock extension on the YouTube theater timeline, in its own colors, while keeping its notices visible.',
      'Automatic theater mode: A corner notice counts down the seconds before the entry; click it or press Esc to cancel, or turn the countdown off in Settings → Features. Now also on Bilibili, Bilibili.tv and Patreon posts with a single native video.',
      'Video launcher: Off by default; turn it on in Settings → Features → Video launcher to enter theater mode with a small button on the left edge of a paused video. It hides during playback, except for the first five seconds after a page or in-app navigation loads. Its tooltip shows your theater shortcut, such as [T]. With YouTube Rich Theater Experience, a white rhombus with an accent triangle stays in the player toolbar regardless of playback or pointer activity. When you turn AutoTheater off, TME offers to enable it.',
      'Fullscreen in theater mode: Double-click the picture to enter or leave fullscreen without leaving theater mode. A single click now plays or pauses faster, and a quick double-click never pauses the video.',
      'Accessibility: Choose High contrast, Reduce transparency and Reduce motion separately (Auto, On or Off) in Settings → Appearance; Auto follows your system preferences. Settings and the player also work better with screen readers.',
      'New feature badges: Recently added features are marked with NEW badges until you open these highlights. To silence them until the next version, use Settings → Appearance → Hide until next version.',
      'Settings warn you about conflicting keyboard shortcuts.',
      'The titles of the videos being played are displayed.',
      'You can go to the home page of the service the video is playing on.',
      'Theater Mode Everywhere should now use fewer resources.',
      'The player now has a dedicated settings menu, and the subtitles menu lets you search long track lists.',
      'A clearer layout of the extension\'s settings page; a new "About" page has been added, with the privacy policy you can read inside the extension.',
      'You can change the language, and the translations have been improved; spotted a mistake? Use Report a translation issue next to Language in Settings.',
      'And many smaller visual refinements, behavior fixes and reliability improvements throughout the extension.'
    ]);
    assert.deepEqual(await root.locator('li strong').allTextContents(), ['New services in Rich Theater Experience', 'RTE chat support', 'Captions under the video:', 'Pin controls', 'Rich Theater Experience', 'Rich Theater Experience', 'Audio effects:', 'SponsorBlock support:', 'Automatic theater mode:', 'Video launcher:', 'Fullscreen in theater mode:', 'Accessibility:', 'New feature badges:']);
    assert.equal(await page.locator('.whats-new-thanks em').textContent(), 'Big thanks to liango2 for the idea of the always-visible interface and to Denis for the idea of automatically entering theater mode.');
    await page.locator('.te-dialog-btn-primary').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.te-dialog-close').evaluate(el => el === document.activeElement), true, 'close button is in the focus loop');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.te-dialog-body').evaluate(el => el === document.activeElement), true, 'shared scroll area is in the focus loop');
    const englishBody = await root.textContent();
    for (const locale of ['pl', 'ar', 'en']) {
      await page.evaluate(`Announcement.languageRuntime.set('${locale}')`);
      assert.equal(await page.locator('.te-dialog-title').textContent(), catalogs[locale].whatsNewDialogTitle.message);
      assert.equal(await page.locator('.te-dialog-btn-primary').textContent(), catalogs[locale].dialogAcknowledge.message);
      assert.equal(await root.textContent(), englishBody);
      assert.equal(await page.locator('.whats-new-thanks').getAttribute('lang'), 'en');
      assert.equal(await page.locator('.whats-new-thanks').getAttribute('dir'), 'ltr');
      assert.equal(await page.locator('.te-dialog-close').getAttribute('aria-label'), catalogs[locale].dialogClose.message);
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

for (const browserType of selectTestEngines([chromium, firefox], engine => engine.name())) {
  it(`${browserType.name()}: highlights keep thanks and actions visible while scrolling and resizing`, { timeout: 30_000 }, async t => {
    const browser = await browserType.launch(); ownTestBrowser(t, browser);
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, reducedMotion: 'reduce' });
    await page.setContent('<html><body><button id="opener">Open</button></body></html>');
    await page.addStyleTag({ content: readStylesheet(new URL('../options/options.css', import.meta.url)) });
    // Settings marks its root through the shared observer; this harness has no extension runtime.
    await page.addStyleTag({ content: readFileSync(new URL('../src/appearance-tokens.css', import.meta.url), 'utf8') });
    await page.evaluate(() => { document.documentElement.dataset.motion = 'reduced'; });
    await page.addScriptTag({ content: bundle });
    await page.locator('#opener').focus();
    await page.evaluate('void Announcement.openWhatsNewDialog()');
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal((await dialog.boundingBox())!.width, 650);
    const scroll = page.locator('.te-dialog-body');
    const thanks = page.locator('.whats-new-thanks');
    const initialThanks = await thanks.boundingBox();
    assert.ok(await scroll.evaluate(el => el.scrollHeight > el.clientHeight));
    await scroll.focus();
    await page.keyboard.press('End');
    await page.waitForFunction(() => {
      const el = document.querySelector('.te-dialog-body')!;
      return Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 1;
    });
    assert.deepEqual(await thanks.boundingBox(), initialThanks);
    for (const viewport of [{ width: 375, height: 550 }, { width: 800, height: 400 }]) {
      await page.setViewportSize(viewport);
      for (const locator of [dialog, thanks, page.locator('.te-dialog-close'), page.locator('.te-dialog-btn-primary')]) {
        const box = (await locator.boundingBox())!;
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height);
      }
      assert.ok(await scroll.evaluate(el => el.clientHeight > 0 && el.scrollWidth <= el.clientWidth));
    }
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.ok(await page.locator('#opener').evaluate(el => el === document.activeElement));
    await page.evaluate('void Announcement.openWhatsNewDialog()');
    await dialog.waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.ok(await page.locator('#opener').evaluate(el => el === document.activeElement));
    await browser.close();
  });
}
