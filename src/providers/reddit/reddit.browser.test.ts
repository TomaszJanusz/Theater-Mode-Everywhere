import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it, type TestContext } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { bootPlayer, bundlePlayer, enterTheater } from '../../test-utils/player-boot';
import { sharedTestBrowser } from '../../test-utils/test-browser';
import { testEngines } from '../../test-utils/test-engines';
import { serveFixture } from '../../test-utils/video-fixtures';

const POST = 'https://www.reddit.com/r/fixture/comments/1fx7rec/recorded_post/';
const CAPTIONS = 'https://v.redd.it/fx7rec0vid01/wh_ben_en.vtt';
const fixtureFile = (name: string) => readFileSync(new URL(`../../../test/host-fixtures/${name}`, import.meta.url), 'utf8');
/** The recorded player (test/host-fixtures/reddit-post-player.json), its shadow roots as declarative shadow DOM. */
const RECORDED_PLAYER = fixtureFile('reddit-post-player.html').replace(/^<!--[\s\S]*?-->\n/, '');
const RECORDED_CAPTIONS = fixtureFile('reddit-post-captions.vtt');
const VOD = readFileSync(new URL('../../../test/fixtures/vod.webm', import.meta.url)).toString('base64');
const RECORDED_VIDEO = '<template shadowrootmode="open"><video aria-label="video player"></video>';

const bundle = bundlePlayer([
  "export { parseCaptionPayload } from './media-features/parsers/captions';",
  "export { RedditAdapter } from './providers/reddit/adapter';"
]);

/**
 * The recording plus what Reddit's stylesheets and hls.js add at run time: the player's size, a playable clip and the
 * empty `subtitles/en "English"` rendition hls.js creates from the stream's playlist.
 */
function page({ captionsOn = true, second = false } = {}): string {
  assert.ok(RECORDED_PLAYER.includes(RECORDED_VIDEO) && RECORDED_PLAYER.includes(' captions-enabled>'), 'recording shape');
  let player = RECORDED_PLAYER.replace(RECORDED_VIDEO, '<template shadowrootmode="open"><style>video { width: 100%; height: 100%; }</style>'
    + `<video aria-label="video player" muted playsinline src="data:video/webm;base64,${VOD}"></video>`);
  if (!captionsOn) player = player.replace(' captions-enabled>', '>');
  // A second post below, as in a feed.
  if (second) player += player.replaceAll('1fx7rec', '2fx7rec').replaceAll('Recorded post title for fixture', 'Second post');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Recorded post title for fixture : r/fixture</title>
<style>body { margin: 0; } shreddit-player { display: block; width: 960px; height: 540px; }</style></head><body>${player}
<video id="inline" muted playsinline></video>
<script>for (const player of document.querySelectorAll('shreddit-player')) player.shadowRoot.querySelector('video').addTextTrack('subtitles', 'English', 'en');</script>
</body></html>`;
}

async function open(page: Page, html: string): Promise<void> {
  // Reddit's CDN serves caption files to any origin.
  await page.route('https://v.redd.it/**', route => route.fulfill({ status: 200, contentType: 'text/vtt', headers: { 'access-control-allow-origin': '*' }, body: RECORDED_CAPTIONS }));
  await serveFixture(page, html, POST);
  await bootPlayer(page, { mainWorld: true, bundle });
  await page.waitForFunction(() => {
    const video = document.querySelector('shreddit-player')?.shadowRoot?.querySelector('video');
    return Boolean(video && video.readyState >= 2 && Number.isFinite(video.duration));
  });
}

/** Runs `body` with the bundled modules; one string keeps the browser side free of tsx helpers. */
const run = <T>(page: Page, body: string) => page.evaluate(`(async () => {
  const T = window.TheaterTest;
  const player = document.querySelector('shreddit-player');
  const video = player.shadowRoot.querySelector('video');
  ${body} })()`) as Promise<T>;

/** Reddit's own caption box, inside the controls' shadow root. */
const redditOverlay = (page: Page, index = 0) => page.evaluate(index => {
  const ui = document.querySelectorAll('shreddit-player')[index]!.shadowRoot!.querySelector('shreddit-media-ui')!;
  const overlay = ui.shadowRoot!.querySelector<HTMLElement>('shreddit-caption-overlay')!;
  return { shown: getComputedStyle(overlay).display !== 'none', style: overlay.getAttribute('style'), enabled: ui.hasAttribute('captions-enabled') };
}, index);

const ccEntries = (page: Page) => page.locator('.theater-cc-menu button').evaluateAll(buttons => buttons.map(button => button.textContent?.trim() ?? ''));

describe('Reddit provider', () => {
  for (const engine of testEngines()) {
    const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
    const newPage = async (t: TestContext, html: string) => {
      const created = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      await open(created, html);
      return created;
    };

    it(`carries Reddit's captions into theater from its caption file, names the post and hands Reddit's caption box back on exit in ${engine}`, { timeout: 40_000 }, async t => {
      const tab = await newPage(t, page());
      assert.deepEqual(await redditOverlay(tab), { shown: true, style: null, enabled: true });
      await enterTheater(tab);
      await tab.locator('.cc-btn.active').waitFor();
      await tab.locator('.theater-title-hud-text', { hasText: 'Recorded post title for fixture' }).first().waitFor({ state: 'attached' });
      assert.equal(await tab.locator('.theater-title-hud-text', { hasText: 'r/fixture' }).count(), 0, 'the post title, not the page title');
      await run(tab, 'video.currentTime = 1.6;');
      await tab.locator('.theater-caption-overlay.visible', { hasText: 'amet' }).waitFor();
      const inTheater = await redditOverlay(tab);
      assert.equal(inTheater.shown, false, 'Reddit\'s captions, drawn under the pinned video, step aside');
      assert.equal(inTheater.enabled, true, 'Reddit\'s own setting is left alone');
      await tab.locator('.cc-btn').click();
      await tab.locator('.theater-cc-menu.visible').waitFor();
      const entries = await ccEntries(tab);
      assert.equal(entries.filter(entry => entry.includes('English')).length, 1, `only the caption file, not hls.js's empty rendition: ${entries.join(' | ')}`);
      await tab.keyboard.press('Escape');
      await tab.keyboard.press('Escape');
      await tab.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
      assert.deepEqual(await redditOverlay(tab), { shown: true, style: '', enabled: true }, 'exit restores the box and keeps the setting');
    });

    it(`starts with captions off when Reddit's are off and offers the caption file in ${engine}`, { timeout: 40_000 }, async t => {
      const tab = await newPage(t, page({ captionsOn: false }));
      await enterTheater(tab);
      await tab.locator('.cc-btn:not([hidden])').waitFor();
      await tab.waitForFunction(() => document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.cc-btn')!.getAttribute('aria-busy') !== 'true');
      assert.equal(await tab.locator('.cc-btn.active').count(), 0);
      await tab.locator('.cc-btn').click();
      await tab.getByRole('button', { name: 'English', exact: true }).click();
      await tab.locator('.cc-btn.active').waitFor();
      await run(tab, 'video.currentTime = 1.6;');
      await tab.locator('.theater-caption-overlay.visible', { hasText: 'amet' }).waitFor();
      assert.equal((await redditOverlay(tab)).enabled, false, 'turning ours on does not switch Reddit\'s on');
    });

    it(`moves the hidden caption box and the title along when Shift+T switches to the next post's player in ${engine}`, { timeout: 40_000 }, async t => {
      const tab = await newPage(t, page({ second: true }));
      await tab.waitForFunction(() => [...document.querySelectorAll('shreddit-player')].every(player => (player.shadowRoot!.querySelector('video')!.readyState) >= 2));
      await enterTheater(tab);
      await tab.locator('.theater-title-hud-text', { hasText: 'Recorded post title for fixture' }).first().waitFor({ state: 'attached' });
      assert.deepEqual([(await redditOverlay(tab, 0)).shown, (await redditOverlay(tab, 1)).shown], [false, true]);
      await tab.keyboard.press('Shift+T');
      await tab.locator('.theater-title-hud-text', { hasText: 'Second post' }).first().waitFor({ state: 'attached' });
      await tab.waitForFunction(() => document.querySelectorAll('shreddit-player')[1]!.shadowRoot!.querySelector('shreddit-media-ui')!
        .shadowRoot!.querySelector<HTMLElement>('shreddit-caption-overlay')!.style.getPropertyValue('display') === 'none');
      assert.deepEqual([(await redditOverlay(tab, 0)).shown, (await redditOverlay(tab, 1)).shown], [true, false], 'the box follows the theater player');
      await tab.keyboard.press('Escape');
      await tab.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
      assert.deepEqual([(await redditOverlay(tab, 0)).style, (await redditOverlay(tab, 1)).style], ['', ''], 'exit restores both');
    });

    it(`follows the player to another post and drops what arrives for the one it left in ${engine}`, { timeout: 40_000 }, async t => {
      const tab = await newPage(t, page());
      const result = await run<Record<string, unknown>>(tab, `
        const releases = [];
        const adapter = new T.RedditAdapter(video, { parseCaptionPayload: T.parseCaptionPayload,
          requestPageFetch: url => new Promise(resolve => releases.push(() => resolve(url === ${JSON.stringify(CAPTIONS)} || url.includes('nextvid') ? ${JSON.stringify(RECORDED_CAPTIONS)} : null))) });
        const inline = new T.RedditAdapter(document.getElementById('inline'), { parseCaptionPayload: T.parseCaptionPayload, requestPageFetch: async () => null });
        const [track] = await adapter.listCaptionTracks();
        const first = { id: adapter.mediaId(), title: adapter.getTitle(), track: track.id + ':' + track.label + ':' + track.language, host: adapter.hostCaptionTrack() === track.id,
          replaces: adapter.replacesElementCaptions(), inline: inline.replacesElementCaptions(), inlineTracks: (await inline.listCaptionTracks()).length };
        const notified = [];
        const stop = adapter.observeTitle(() => notified.push(adapter.mediaId()));
        const pending = adapter.activateCaptionTrack(track.id);
        // Reddit points the same player at the next post while the file is loading.
        player.setAttribute('post-id', 't3_next01');
        player.setAttribute('post-title', 'Next post');
        player.setAttribute('caption-url', 'https://v.redd.it/nextvid0001/wh_ben_en.vtt');
        releases.shift()();
        const stale = (await pending).status;
        const [next] = await adapter.listCaptionTracks();
        const moved = { id: adapter.mediaId(), title: adapter.getTitle(), track: next.id };
        const oldPick = (await adapter.activateCaptionTrack(track.id)).status;
        const superseded = adapter.activateCaptionTrack(next.id);
        const off = (await adapter.activateCaptionTrack(null)).status;
        releases.shift()();
        const supersededStatus = (await superseded).status;
        const picked = adapter.activateCaptionTrack(next.id);
        releases.shift()();
        const active = await picked;
        player.setAttribute('caption-url', 'https://evil.test/nextvid0001/wh_ben_en.vtt');
        const hostile = (await adapter.listCaptionTracks()).length;
        const beforeStop = notified.length;
        stop();
        player.setAttribute('post-title', 'After stop');
        await new Promise(resolve => queueMicrotask(resolve));
        player.shadowRoot.querySelector('shreddit-media-ui').removeAttribute('captions-enabled');
        player.setAttribute('caption-url', 'https://v.redd.it/nextvid0001/wh_ben_en.vtt');
        return { first, stale, next: moved, notified: notified.length > 0 && notified.every(id => id === 't3_next01'),
          oldPick, off, supersededStatus, active: { status: active.status, lines: active.cues.length, text: active.cues[0]?.text }, hostile,
          quiet: notified.length === beforeStop, hostOff: adapter.hostCaptionTrack() };`);
      assert.deepEqual(result.first, { id: 't3_1fx7rec', title: 'Recorded post title for fixture', track: `reddit:t3_1fx7rec:${CAPTIONS}:English:en`, host: true,
        replaces: true, inline: false, inlineTracks: 0 });
      assert.equal(result.stale, 'failed', 'the file of the post the player left is not shown');
      assert.deepEqual(result.next, { id: 't3_next01', title: 'Next post', track: 'reddit:t3_next01:https://v.redd.it/nextvid0001/wh_ben_en.vtt' });
      assert.equal(result.notified, true, 'the title observer reports the new post');
      assert.equal(result.oldPick, 'failed', 'the previous post\'s track cannot be picked any more');
      assert.equal(result.off, 'off');
      assert.equal(result.supersededStatus, 'failed', 'a pick replaced before its file arrived is dropped');
      assert.deepEqual(result.active, { status: 'active', lines: 4, text: 'amet' });
      assert.equal(result.hostile, 0, 'a caption URL off Reddit\'s CDN is not offered');
      assert.equal(result.hostOff, null, 'Reddit\'s captions off: no host track');
      assert.equal(result.quiet, true, 'cleanup stops the observer');
    });
  }
});
