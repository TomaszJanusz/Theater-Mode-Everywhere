import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';


import { sharedEngineBrowsers } from './test-utils/engine-browsers';
import { bundleModules } from './test-utils/player-boot';
import { readStylesheet } from './test-utils/styles';
import { testEngines } from './test-utils/test-engines';

const bundle = bundleModules([
  "export { buildWhatsNewContent, WHATS_NEW_RELEASES } from './whatsNew-content';",
  "export { openWhatsNewDialog } from './whatsNew';",
  "export { languageRuntime } from './i18n-runtime';"
], 'Announcement');
const browsers = sharedEngineBrowsers();
const catalogs = Object.fromEntries(['en', 'pl', 'ar'].map(locale => [locale,
  JSON.parse(readFileSync(new URL(`../_locales/${locale}/messages.json`, import.meta.url), 'utf8'))
]));

it('renders static English semantic content safely and refreshes localized dialog labels in place', { timeout: 30_000 }, async t => {
  const page = await (await browsers.chromium.newContext(t)).newPage();
  await page.setContent('<html><body><button id="opener">Open</button></body></html>');
  await page.evaluate('window.__name = value => value');
  await page.evaluate(catalogs => {
    const sent: string[] = [];
    Object.assign(window, { sent, chrome: {
      runtime: { sendMessage: async ({ action, locale }: { action: string; locale: string }) => { sent.push(action); return catalogs[locale]; } },
      storage: { local: { get: async () => ({ pendingUpdate: { version: '2.1.0', since: '2.0' } }) } }
    } });
    // Any HTML parsing in the announcement/dialog renderer fails this regression.
    Object.defineProperty(Element.prototype, 'innerHTML', { set() { throw new Error('HTML parsing is forbidden'); } });
  }, catalogs);
  await page.addScriptTag({ content: bundle });
  await page.locator('#opener').focus();
  await page.evaluate('void Announcement.openWhatsNewDialog()');
  await page.getByRole('dialog').waitFor();
  // Opening the highlights acknowledges the announced update; the background owns that write.
  assert.deepEqual(await page.evaluate('sent'), ['acknowledge-update']);
  const root = page.locator('.whats-new-content');
  assert.equal(await root.getAttribute('lang'), 'en');
  assert.equal(await root.getAttribute('dir'), 'ltr');
  // A 2.0.8 upgrader (announced since 2.0) sees 2.1 only.
  assert.deepEqual(await root.locator('h3 strong').allTextContents(), ['Here is Theater Mode Everywhere 2.1!']);
  assert.equal(await root.locator(':scope > p').first().textContent(), "I'm happy to share an update that makes the end of a video feel finished, lets you tune each service on its own, and brings theater mode to a few more places.");
  assert.equal(await root.locator(':scope > p strong').textContent(), 'the end of a video');
  assert.deepEqual(await root.locator('ul > li').allTextContents(), [
    'A proper ending: When a video ends, a calm black screen with Replay (and Next, when a playlist has one) now replaces the frozen last frame. Services with their own next-episode step, such as Netflix and Disney+, keep theirs.',
    "YouTube recommendations: With Rich Theater Experience, the end of a YouTube video shows up to three suggestions you can pick without leaving theater mode, and YouTube's autoplay countdown appears right in our player, with Cancel. Not your thing? Turn off the Show recommendations switch under them.",
    'Settings for each service: Service cards in Settings → Features have a new Settings button, where you can switch YouTube recommendations on or off and choose AutoTheater for that service alone.',
    'A quick setup: A fresh install now asks three short questions about services, how theater mode starts and a few extras. Changed your mind later? Settings → About has Run setup again, and Reset to defaults for a clean start.',
    'Updates stay out of your way: A new version no longer opens a tab. A NEW badge on the toolbar icon, a note in the popup and a line at the bottom of the player menu lead you here instead; open any of them and the badge goes away.',
    'Audio tracks and subtitle language: Choose a dub or the original audio from the player settings on Netflix, Disney+ and YouTube, and I will remember your language for that service. While subtitles load, the corner notice already shows which language is coming.',
    "New services in Rich Theater Experience: SOOP, iQIYI and Rakuten Viki, with episode navigation, subtitle and audio choices and AutoTheater where the service allows it. SOOP's own chat joins you beside the video.",
    'Speed keys: Press < and > to change the speed as you do on YouTube, or hold Seek Forward to play at 2x until you let go.',
    "And a few smaller things: drag the edge of the chat to resize it, move around the player bar with W, A, S and D, theater on YouTube's miniplayer, Czech and Slovak translations, and clearer keyboard shortcut names and help."
  ]);
  assert.deepEqual(await root.locator('li strong').allTextContents(), ['A proper ending', 'YouTube recommendations', 'Settings for each service', 'A quick setup', 'Updates stay out of your way', 'Audio tracks and subtitle language', 'New services in Rich Theater Experience', 'Speed keys']);
  assert.equal(await page.locator('.whats-new-thanks em').textContent(), 'Big thanks to @wesleyel for the groundwork behind the playback speed keys and holding Seek Forward for 2x.');
  const profiles = page.locator('.whats-new-thanks a');
  assert.deepEqual(await profiles.evaluateAll(links => links.map(link => ({
    text: link.textContent, href: link.getAttribute('href'), target: link.getAttribute('target'), rel: link.getAttribute('rel')
  }))), [
    { text: '@wesleyel', href: 'https://github.com/wesleyel', target: '_blank', rel: 'noopener noreferrer' }
  ]);
  assert.equal(await page.getByRole('link', { name: '@wesleyel' }).count(), 1);
  await page.locator('.te-dialog-btn-primary').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.te-dialog-close').evaluate(el => el === document.activeElement), true, 'close button is in the focus loop');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.te-dialog-body').evaluate(el => el === document.activeElement), true, 'shared scroll area is in the focus loop');
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('link', { name: '@wesleyel' }).evaluate(el => el === document.activeElement), true, '@wesleyel is in the focus loop');
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
      WHATS_NEW_RELEASES: Array<{ heading: string }>; buildWhatsNewContent(): HTMLElement;
    } }).Announcement;
    api.WHATS_NEW_RELEASES[0].heading = payload;
    const content = api.buildWhatsNewContent();
    return { heading: content.querySelector('h3')?.textContent, injected: content.querySelectorAll('script, img').length };
  }, payload);
  assert.deepEqual(safe, { heading: payload, injected: 0 });
  // A link is only ever an absolute https: address; any other keeps its text without becoming a link.
  const links = await page.evaluate(() => {
    const api = (window as unknown as { Announcement: {
      WHATS_NEW_RELEASES: Array<{ thanks: unknown[] }>; buildWhatsNewContent(): HTMLElement;
    } }).Announcement;
    api.WHATS_NEW_RELEASES[0].thanks = ['Thanks to ', ...['javascript:alert(1)', 'http://github.com/wesleyel', '//github.com/wesleyel', 'data:text/html,x', 'https://github.com/wesleyel']
      .map((href, index) => ({ link: `link${index}`, href }))];
    const thanks = api.buildWhatsNewContent().querySelector('.whats-new-thanks')!;
    return { text: thanks.textContent, hrefs: [...thanks.querySelectorAll('a')].map(link => link.getAttribute('href')) };
  });
  assert.deepEqual(links, { text: 'Thanks to link0link1link2link3link4', hrefs: ['https://github.com/wesleyel'] });
  await page.locator('.te-dialog-btn-primary').click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#opener').evaluate(el => el === document.activeElement), true);
});

it('shows 2.0 below 2.1, each with its own thanks, to someone who never saw the 2.0 highlights', { timeout: 30_000 }, async t => {
  const page = await (await browsers.chromium.newContext(t)).newPage();
  await page.setContent('<html><body></body></html>');
  await page.evaluate('window.__name = value => value');
  await page.evaluate(catalogs => {
    Object.assign(window, { chrome: {
      runtime: { sendMessage: async ({ locale }: { locale: string }) => catalogs[locale] },
      storage: { local: { get: async () => ({ pendingUpdate: { version: '2.1.0', since: '1.9' } }) } }
    } });
  }, catalogs);
  await page.addScriptTag({ content: bundle });
  await page.evaluate('void Announcement.openWhatsNewDialog()');
  await page.getByRole('dialog').waitFor();
  assert.deepEqual(await page.locator('.whats-new-content h3 strong').allTextContents(),
    ['Here is Theater Mode Everywhere 2.1!', 'Here is Theater Mode Everywhere 2.0!']);
  assert.deepEqual(await page.locator('.whats-new-thanks em').allTextContents(), [
    'Big thanks to @wesleyel for the groundwork behind the playback speed keys and holding Seek Forward for 2x.',
    'Big thanks to @liango2 for the idea of the always-visible interface and to Denis for the idea of automatically entering theater mode.'
  ]);
});

for (const engine of testEngines()) {
  it(`${engine}: highlights keep thanks and actions visible while scrolling and resizing`, { timeout: 30_000 }, async t => {
    const page = await (await browsers[engine].newContext(t, { viewport: { width: 1000, height: 800 }, reducedMotion: 'reduce' })).newPage();
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
    // A profile link opens in a new tab and leaves the highlights open.
    await page.context().route('https://github.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Profile</title>' }));
    const [profile] = await Promise.all([page.context().waitForEvent('page'), page.getByRole('link', { name: '@wesleyel' }).click()]);
    await profile.waitForLoadState();
    assert.equal(profile.url(), 'https://github.com/wesleyel');
    assert.equal(await profile.evaluate(() => window.opener), null);
    await profile.close();
    await dialog.waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.ok(await page.locator('#opener').evaluate(el => el === document.activeElement));
    await page.evaluate('void Announcement.openWhatsNewDialog()');
    await dialog.waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert.ok(await page.locator('#opener').evaluate(el => el === document.activeElement));
  });
}
