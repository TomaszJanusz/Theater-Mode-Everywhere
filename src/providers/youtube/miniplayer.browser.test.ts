import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it, type TestContext } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { bootPlayer } from '../../test-utils/player-boot';
import { readStylesheet } from '../../test-utils/styles';
import { sharedTestBrowser } from '../../test-utils/test-browser';
import { testEngines } from '../../test-utils/test-engines';

const MEDIA = `data:video/webm;base64,${readFileSync(new URL('../../../test/fixtures/vod.webm', import.meta.url)).toString('base64')}`;
const PRESENTATION = readStylesheet(new URL('./presentation.css', import.meta.url).pathname);

// Hand-built from the live structure (YouTube web client 2.20261022, logged out): the playing
// player moves into ytd-miniplayer and ytd-app carries miniplayer-is-active while it shows.
// The miniplayer's own box gives the player a containing block, as YouTube's does.
const HOME = `<style>
  body { margin: 0; }
  ytd-miniplayer { position: fixed; right: 16px; bottom: 16px; width: 400px; height: 301px; contain: layout; }
  #movie_player { position: relative; width: 400px; height: 225px; }
  video { position: absolute; left: 0; top: 0; width: 400px; height: 225px; }
  ytd-watch-flexy[hidden] { display: none; }
</style>
<ytd-app miniplayer-is-active>
  <ytd-page-manager>
    <ytd-browse><p id="listing">Home</p><ytd-video-preview><video id="preview" style="position:static;width:320px;height:180px"></video></ytd-video-preview></ytd-browse>
    <ytd-watch-flexy hidden><div id="player-container"></div><h1 class="ytd-watch-metadata">Previous watch page</h1></ytd-watch-flexy>
  </ytd-page-manager>
  <ytd-miniplayer style="right: 16px; bottom: 16px;"><div id="movie_player" class="html5-video-player ytp-player-minimized"><video id="parked" class="html5-main-video" style="width: 400px; height: 225px; left: 0px; top: 0px;"></video></div></ytd-miniplayer>
</ytd-app>`;

declare global {
  interface Window {
    /** What the fake player API reports: `getVideoData()` and, when set, a lagging `getPlayerResponse()`. */
    host: { id: string; responseId?: string };
    /** Titles the fake player response carries per video id. */
    titles: Record<string, string>;
  }
}

async function openHome(t: TestContext, shared: ReturnType<typeof sharedTestBrowser>, { clock = true, settings = {} } = {}): Promise<Page> {
  const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: HOME }));
  await page.goto('https://www.youtube.com/');
  await page.evaluate(media => {
    window.host = { id: 'aaaaaaaaaaa' };
    window.titles = { aaaaaaaaaaa: 'Parked video', bbbbbbbbbbb: 'Next in queue' };
    // Page metadata left over from the watch page and Home's own: neither describes the parked video.
    document.title = 'Previous watch page - YouTube';
    const player = document.getElementById('movie_player') as HTMLElement & Record<string, unknown>;
    player.getVideoData = () => ({ video_id: window.host.id });
    player.getPlayerResponse = () => {
      const videoId = window.host.responseId ?? window.host.id;
      return { videoDetails: { videoId, title: window.titles[videoId], lengthSeconds: '10' } };
    };
    // Muted and looping reads as decoration to the launcher; the parked player is neither.
    for (const video of document.querySelectorAll('video')) { video.muted = video.loop = video.id === 'preview'; video.src = media; }
  }, MEDIA);
  await page.waitForFunction(() => [...document.querySelectorAll('video')].every(video => video.readyState >= 2));
  await page.addStyleTag({ content: PRESENTATION });
  if (clock) {
    // A paused clock makes the lost-surface grace exact.
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 60_000));
  }
  await bootPlayer(page, { mainWorld: true, settings });
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
  return page;
}

/** The miniplayer subtree as YouTube left it: every style and class the session could touch. */
const hostState = (page: Page) => page.evaluate(() => [document.querySelector('ytd-app')!, ...document.querySelectorAll('ytd-miniplayer, ytd-miniplayer *')]
  .map(element => `${element.tagName}#${element.id}|${element.getAttribute('style') ?? ''}|${element.getAttribute('class') ?? ''}|${element.hasAttribute('miniplayer-is-active')}`));

const active = (page: Page) => page.evaluate(() => document.documentElement.classList.contains('theater-everywhere-html-active'));
const bound = (page: Page) => page.evaluate(() => document.querySelector('video[data-theater-everywhere]')?.id ?? null);
// The toggle ignores presses for 200 ms; run that debounce on the fake clock.
async function toggle(page: Page, key = 't'): Promise<void> {
  await page.keyboard.press(key);
  await page.clock.runFor(300);
}
const publish = (page: Page, event: string) => page.evaluate(name => window.dispatchEvent(new Event(name)), event);

for (const engine of testEngines()) {
  const shared = sharedTestBrowser(({ chromium, firefox })[engine]);

  it(`${engine}: the shortcut enters theater on the parked miniplayer video and exit restores the miniplayer`, { timeout: 40_000 }, async t => {
    const page = await openHome(t, shared);
    const parked = await hostState(page);
    const playing = await page.evaluate(() => document.querySelector<HTMLVideoElement>('#parked')!.paused);
    await toggle(page);
    assert.equal(await bound(page), 'parked', 'the preview stays excluded; the miniplayer is the fallback target');
    // The miniplayer's containing block must not offset the full-viewport stage.
    assert.deepEqual(await page.evaluate(() => {
      const { x, y, width, height } = document.getElementById('parked')!.getBoundingClientRect();
      return { x, y, width, height, listing: getComputedStyle(document.getElementById('listing')!).visibility };
    }), { x: 0, y: 0, width: 1280, height: 720, listing: 'hidden' });
    await toggle(page, 'Escape');
    assert.equal(await active(page), false);
    assert.deepEqual(await hostState(page), parked);
    assert.equal(await page.evaluate(() => document.querySelector<HTMLVideoElement>('#parked')!.paused), playing);
    assert.equal(await page.locator('.theater-everywhere-parent-active, [data-theater-everywhere]').count(), 0);
  });

  it(`${engine}: the video launcher appears on the parked miniplayer video and enters theater on it`, { timeout: 40_000 }, async t => {
    const page = await openHome(t, shared, { clock: false, settings: { videoActivator: true } });
    const launcher = page.locator('#theater-everywhere-ui .theater-video-activator');
    // The same overlay launcher as on any player: one third down the miniplayer's left edge.
    await page.mouse.move(600, 300);
    await page.mouse.move(1080, 600, { steps: 5 });
    await launcher.waitFor();
    const [box, video] = await Promise.all([launcher.boundingBox(), page.locator('#parked').boundingBox()]);
    assert.equal(Math.round(box!.x), Math.round(video!.x) + 12);
    await launcher.click();
    await page.waitForFunction(() => document.querySelector('video[data-theater-everywhere]')?.id === 'parked');
  });

  it(`${engine}: entry waits for the host player to confirm the parked video`, { timeout: 40_000 }, async t => {
    const page = await openHome(t, shared);
    // getPlayerResponse() still describes the previous video.
    await page.evaluate(() => { window.host.responseId = 'zzzzzzzzzzz'; });
    await toggle(page);
    assert.equal(await active(page), false);
    await page.evaluate(() => { delete window.host.responseId; document.getElementById('movie_player')!.classList.add('ad-showing'); });
    await toggle(page);
    assert.equal(await active(page), false, 'an ad in the miniplayer is not the content');
    await page.evaluate(() => document.getElementById('movie_player')!.classList.remove('ad-showing'));
    await toggle(page);
    assert.equal(await bound(page), 'parked');
  });

  it(`${engine}: a miniplayer session follows the next video and other listings, and ends when the miniplayer closes`, { timeout: 40_000 }, async t => {
    const page = await openHome(t, shared);
    await toggle(page);
    assert.equal(await bound(page), 'parked');
    // The next queue item reuses the element; the two player reads disagree for a moment.
    await page.evaluate(() => { window.host = { id: 'bbbbbbbbbbb', responseId: 'aaaaaaaaaaa' }; });
    await publish(page, 'yt-player-updated');
    await page.evaluate(() => { delete window.host.responseId; });
    await publish(page, 'yt-player-updated');
    await page.clock.runFor(2000);
    assert.equal(await bound(page), 'parked', 'the session keeps the next video');
    // The miniplayer persists across listing routes, and so does the session.
    await page.evaluate(() => { history.pushState({}, '', '/results?search_query=x'); window.dispatchEvent(new Event('yt-navigate-start')); window.dispatchEvent(new PopStateEvent('popstate')); });
    await page.clock.runFor(2000);
    assert.equal(await bound(page), 'parked');
    // Closing clears the mark and moves the paused player back into the hidden watch page.
    await page.evaluate(() => {
      document.querySelector('ytd-app')!.removeAttribute('miniplayer-is-active');
      document.getElementById('player-container')!.append(document.getElementById('movie_player')!);
      document.querySelector<HTMLVideoElement>('#parked')!.pause();
    });
    await page.clock.runFor(2000);
    assert.equal(await active(page), false);
    assert.equal(await page.locator('.theater-everywhere-parent-active, [data-theater-everywhere]').count(), 0);
  });

  it(`${engine}: expanding the miniplayer continues the session as a watch session`, { timeout: 40_000 }, async t => {
    const page = await openHome(t, shared);
    await toggle(page);
    assert.equal(await bound(page), 'parked');
    // The route and the mark change first; the player moves into the revealed watch page later.
    await page.evaluate(() => {
      history.pushState({}, '', '/watch?v=aaaaaaaaaaa');
      document.querySelector('ytd-app')!.removeAttribute('miniplayer-is-active');
      window.dispatchEvent(new Event('yt-navigate-start'));
    });
    await page.clock.runFor(2000);
    assert.equal(await bound(page), 'parked', 'still on its way to the watch page');
    await page.evaluate(() => {
      const flexy = document.querySelector('ytd-watch-flexy')!;
      flexy.querySelector('#player-container')!.append(document.getElementById('movie_player')!);
      flexy.removeAttribute('hidden');
      document.getElementById('movie_player')!.classList.remove('ytp-player-minimized');
      window.dispatchEvent(new Event('yt-page-data-updated'));
    });
    await page.clock.runFor(2000);
    assert.equal(await bound(page), 'parked');
    // YouTube sizes the video for the watch page while theater holds it.
    await page.evaluate(() => Object.assign(document.getElementById('parked')!.style, { width: '800px', height: '450px' }));
    await page.clock.runFor(300);
    // Now a watch session: leaving the watch page ends it, as for any watch session.
    await page.evaluate(() => { history.pushState({}, '', '/'); window.dispatchEvent(new Event('yt-navigate-start')); });
    await page.clock.runFor(300);
    assert.equal(await active(page), false);
    // Exit restores the host's latest geometry, not the miniplayer's from entry.
    assert.equal(await page.evaluate(() => document.getElementById('parked')!.getAttribute('style')), 'width: 800px; height: 450px; left: 0px; top: 0px;');
  });

  it(`${engine}: the title follows the parked video and never shows the page's or the previous video's`, { timeout: 40_000 }, async t => {
    const page = await openHome(t, shared);
    const title = async (): Promise<string> => {
      await page.clock.runFor(1000);
      // A long title scrolls as two copies of the text; the first is the title.
      return (await page.locator('.theater-everywhere-title-hud .theater-title-hud-text').allTextContents())[0] ?? '';
    };
    await toggle(page);
    assert.equal(await title(), 'Parked video');
    // The next queue item: getPlayerResponse() still describes the previous video for a moment.
    await page.evaluate(() => { window.host = { id: 'bbbbbbbbbbb', responseId: 'aaaaaaaaaaa' }; });
    await publish(page, 'yt-player-updated');
    assert.equal(await title(), '', 'unknown while the player reads disagree');
    await page.evaluate(() => { delete window.host.responseId; });
    await publish(page, 'yt-player-updated');
    assert.equal(await title(), 'Next in queue');
    // A parked video without a title of its own shows none, not the page's.
    await page.evaluate(() => { window.host = { id: 'ccccccccccc' }; });
    await publish(page, 'yt-player-updated');
    assert.equal(await title(), '');
  });
}
