import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { bootPlayer, bundlePlayer, enterTheater } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { selectTestEngines } from '../test-utils/test-engines';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MEDIA = readFileSync(path.join(ROOT, 'test/fixtures/vod.webm'));
const browsers = { Chromium: sharedTestBrowser(chromium), Firefox: sharedTestBrowser(firefox) };
const bundle = bundlePlayer(["export { bridgedVideoQuality } from './providers/video-quality-bridge';"]);

const STYLE = '<style>body{margin:0;background:#111}video{width:960px;height:540px}</style>';

/**
 * YouTube's player API as measured logged out on a 4K watch page (player 6b3d0364, 2026-11): quality data highest
 * first with labels, `auto` as the preferred quality until a level is fixed, and the range setter fixing one.
 */
const YOUTUBE_PAGE = `<!doctype html><meta charset="utf-8"><title>Quality</title>${STYLE}
<div id="movie_player" class="html5-video-player"><video muted loop src="/vod.webm"></video></div>
<script>
  const player = document.getElementById('movie_player');
  const listeners = {};
  const data = [['hd2160', '2160p60'], ['hd1080', '1080p60'], ['hd720', '720p60'], ['large', '480p'], ['medium', '360p']]
    .map(([quality, qualityLabel]) => ({ quality, qualityLabel, isPlayable: true }))
    .concat([{ quality: 'hd1080', qualityLabel: '1080p Premium', isPlayable: false }]);
  window.__state = { videoId: 'aqz-KE-bpKQ', preferred: 'auto', playing: 'large', ranges: [] };
  window.__emit = name => (listeners[name] || []).forEach(fn => fn());
  Object.assign(player, {
    addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); },
    getVideoData: () => ({ video_id: window.__state.videoId }),
    getAvailableQualityData: () => data,
    getPreferredQuality: () => window.__state.preferred,
    getPlaybackQuality: () => window.__state.playing,
    setPlaybackQualityRange: (min, max) => {
      window.__state.ranges.push(min + '/' + max);
      window.__state.preferred = min;
      if (min !== 'auto') window.__state.playing = min;
      window.__emit('onPlaybackQualityChange');
    }
  });
</script>`;

/**
 * Twitch's media player as measured logged out (2026-11): reachable only through the React props above the video's
 * host element, bound to the element it plays into, with Auto as its own mode. On a past broadcast it names no
 * channel; the VOD playlist it plays (`getPath()`) is what names the recording.
 */
const twitchPage = (vod?: string) => `<!doctype html><meta charset="utf-8"><title>Quality</title>${STYLE}
<div class="video-player"><div class="video-ref"><video muted loop src="/vod.webm"></video></div></div>
<script>
  const video = document.querySelector('video');
  const qualities = [['1080p60', '1080p60', 1080], ['720p60', '720p60', 720], ['480p30', '480p', 480], ['160p30', '160p', 160]]
    .map(([group, name, height]) => ({ group, name, height, bitrate: height * 1000 }));
  const vod = ${JSON.stringify(vod ?? null)};
  window.__state = { auto: true, current: qualities[1], element: video, calls: [],
    path: vod ? 'https://usher.ttvnw.net/vod/v2/' + vod + '.m3u8?sig=fixture' : 'https://usher.ttvnw.net/api/v2/channel/hls/fixturechannel.m3u8' };
  const instance = {
    getHTMLVideoElement: () => window.__state.element,
    getQualities: () => qualities,
    getQuality: () => window.__state.current,
    isAutoQualityMode: () => window.__state.auto,
    setQuality: quality => { window.__state.calls.push(quality.group); window.__state.auto = false; window.__state.current = quality; },
    setAutoQualityMode: auto => { window.__state.calls.push('auto:' + auto); window.__state.auto = auto; },
    getLoadedChannelLogin: () => vod ? undefined : 'fixturechannel',
    getPath: () => window.__state.path
  };
  // The host element's fiber, a few components below the player that holds the instance.
  document.querySelector('.video-ref').__reactFiber$fixture = { return: { return: { memoizedProps: { mediaPlayerInstance: instance } } } };
</script>`;

async function boot(t: TestContext, name: keyof typeof browsers, origin: string, route: string, html: string): Promise<Page> {
  const page = await (await browsers[name].newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.route(`${origin}/**`, request => request.fulfill(request.request().url().endsWith('/vod.webm')
    ? { body: MEDIA, contentType: 'video/webm' }
    : { contentType: 'text/html', body: html }));
  await page.goto(`${origin}${route}`);
  await page.waitForFunction(() => document.querySelector('video')!.readyState >= 2);
  await bootPlayer(page, { settings: { keepControlsVisible: true }, mainWorld: true, bundle });
  await enterTheater(page);
  return page;
}

const row = (page: Page) => page.locator('.video-quality-btn');
const choices = (page: Page) => page.locator('#theater-video-quality-list button');
const openSettings = async (page: Page) => {
  if (!await page.locator('.theater-settings-menu.visible').count()) await page.locator('.player-settings-btn').click();
  await page.locator('.theater-settings-menu.visible').waitFor();
};
/** The menu's state: the row's accessible name and, once opened, each choice with its check. */
const listed = async (page: Page) => (await choices(page).evaluateAll(buttons => buttons.map(button =>
  `${button.querySelector('.theater-cc-menu-label')!.textContent}${button.getAttribute('aria-pressed') === 'true' ? ' ✓' : ''}`)));

for (const name of selectTestEngines(['Chromium', 'Firefox'] as const, engine => engine)) {
  describe(`Video quality in the player settings (${name})`, () => {
    it('YouTube: lists the playable levels, fixes one by pointer, returns to Auto by keyboard', { timeout: 60_000 }, async t => {
      const page = await boot(t, name, 'https://www.youtube.com', '/watch?v=aqz-KE-bpKQ', YOUTUBE_PAGE);
      await openSettings(page);
      assert.equal(await row(page).getAttribute('aria-label'), 'Video quality: Auto (480p)');
      await row(page).click();
      // The Premium level is not playable logged out and stays out; the search field stays out of a short list.
      assert.deepEqual(await listed(page), ['Auto (480p) ✓', '2160p60', '1080p60', '720p60', '480p', '360p']);
      assert.equal(await page.locator('.theater-settings-subview .theater-cc-search').isHidden(), true);
      await choices(page).filter({ hasText: '720p60' }).click();
      await page.locator('.theater-settings-menu.visible').waitFor({ state: 'detached' }).catch(() => {});
      assert.deepEqual(await page.evaluate('window.__state.ranges'), ['hd720/hd720']);

      await openSettings(page);
      await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')!.shadowRoot!
        .querySelector('.video-quality-btn')!.getAttribute('aria-label') === 'Video quality: 720p60');
      await row(page).focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')!.shadowRoot!.activeElement?.closest('#theater-video-quality-list'));
      assert.deepEqual(await listed(page), ['Auto (720p60)', '2160p60', '1080p60', '720p60 ✓', '480p', '360p']);
      await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate('window.__state.ranges'), ['hd720/hd720', 'auto/auto']);
    });

    it('YouTube: hides the row during an ad and with the integration off, and refuses a pick for an earlier video', { timeout: 60_000 }, async t => {
      const page = await boot(t, name, 'https://www.youtube.com', '/watch?v=aqz-KE-bpKQ', YOUTUBE_PAGE);
      await openSettings(page);
      await row(page).waitFor({ state: 'visible' });
      await page.evaluate(`document.getElementById('movie_player').classList.add('ad-showing'); window.__emit('onStateChange')`);
      await row(page).waitFor({ state: 'hidden' });
      await page.evaluate(`document.getElementById('movie_player').classList.remove('ad-showing'); window.__emit('onStateChange')`);
      await row(page).waitFor({ state: 'visible' });

      // A pick made for the previous video never reaches the player once it moved on.
      const refused = await page.evaluate(`(() => {
        const source = TheaterTest.bridgedVideoQuality('youtube', document.querySelector('video'));
        window.__state.videoId = 'next-video0';
        return [source.select('hd1080', 'aqz-KE-bpKQ'), source.select('not-offered', 'next-video0'), source.read()?.mediaId];
      })()`);
      assert.deepEqual(refused, [false, false, 'next-video0']);
      assert.deepEqual(await page.evaluate('window.__state.ranges'), []);

      await page.keyboard.press('Escape');
      await page.evaluate(`document.documentElement.setAttribute('data-te-youtube-integration-off', '')`);
      await openSettings(page);
      await row(page).waitFor({ state: 'hidden' });
    });

    it('Twitch: reads the media player bound to the theater video and switches through it', { timeout: 60_000 }, async t => {
      const page = await boot(t, name, 'https://www.twitch.tv', '/fixturechannel', twitchPage());
      await openSettings(page);
      assert.equal(await row(page).getAttribute('aria-label'), 'Video quality: Auto (720p60)');
      await row(page).click();
      assert.deepEqual(await listed(page), ['Auto (720p60) ✓', '1080p60', '720p60', '480p', '160p']);
      await choices(page).filter({ hasText: '160p' }).click();
      await openSettings(page);
      await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')!.shadowRoot!
        .querySelector('.video-quality-btn')!.getAttribute('aria-label') === 'Video quality: 160p');
      await row(page).click();
      await choices(page).first().click();
      assert.deepEqual(await page.evaluate('window.__state.calls'), ['160p30', 'auto:true']);

      // A player instance that plays into another element is not this video's.
      await page.evaluate(`window.__state.element = document.createElement('video'); document.querySelector('video').dispatchEvent(new Event('resize'))`);
      await openSettings(page);
      await row(page).waitFor({ state: 'hidden' });
    });

    it('Twitch: offers a past broadcast\'s levels and refuses a pick once the player loads another one', { timeout: 60_000 }, async t => {
      const page = await boot(t, name, 'https://www.twitch.tv', '/videos/2936407922', twitchPage('2936407922'));
      await openSettings(page);
      assert.equal(await row(page).getAttribute('aria-label'), 'Video quality: Auto (720p60)');
      await row(page).click();
      assert.deepEqual(await listed(page), ['Auto (720p60) ✓', '1080p60', '720p60', '480p', '160p']);
      await choices(page).filter({ hasText: '480p' }).click();
      assert.deepEqual(await page.evaluate('window.__state.calls'), ['480p30']);

      // In-app navigation to another VOD: the URL moves first, the pick follows what the player plays.
      const refused = await page.evaluate(`(() => {
        const source = TheaterTest.bridgedVideoQuality('twitch', document.querySelector('video'));
        history.pushState(null, '', '/videos/1111111111');
        const beforeSwitch = source.read()?.mediaId;
        window.__state.path = 'https://usher.ttvnw.net/vod/v2/1111111111.m3u8?sig=fixture';
        return [beforeSwitch, source.select('160p30', 'videos/2936407922'), source.read()?.mediaId];
      })()`);
      assert.deepEqual(refused, ['videos/2936407922', false, 'videos/1111111111']);
      assert.deepEqual(await page.evaluate('window.__state.calls'), ['480p30']);
    });
  });
}
