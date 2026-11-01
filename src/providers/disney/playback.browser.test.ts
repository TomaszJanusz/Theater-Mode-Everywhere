import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it, type TestContext } from 'node:test';

import type { Page } from 'playwright';

import { sharedEngineBrowsers } from '../../test-utils/engine-browsers';
import { bootPlayer, enterTheater } from '../../test-utils/player-boot';
import { testEngines } from '../../test-utils/test-engines';

const browsers = sharedEngineBrowsers();
const PLAY = '86e14fdb-3841-4282-ad38-07c8c4aab4b6';
const MEDIA = `data:video/webm;base64,${readFileSync(new URL('../../../test/fixtures/vod.webm', import.meta.url)).toString('base64')}`;
const HTML = `<!doctype html><title>Disney+</title><body style="margin:0"><disney-web-player>
  <video class="hive-video" loop muted playsinline src="${MEDIA}" style="width:960px;height:540px"></video></disney-web-player></body>`;

/**
 * Hive as recorded on a signed-in film (`disney-watch-states.json`, `playbackModel`): `mediaPlayer.pause()/play()` and
 * `stateStore` on `disney-web-player`. Its model runs on its own clock: while it believes the title plays, its playhead
 * advances whatever the element does, and a media reload resumes from that playhead, but only if the model says PLAYING.
 * `direct` lists what other code did to the element itself; Hive's own calls do not appear in it.
 */
const fakeHive = `(() => {
  const web = document.querySelector('disney-web-player');
  const video = web.querySelector('video');
  const hive = window.__hive = { state: 'playing', playheadMs: 32_000, calls: [], direct: [], reloads: 0, resumedFrom: [] };
  const nativePause = video.pause.bind(video);
  const nativePlay = video.play.bind(video);
  video.pause = () => { hive.direct.push('pause'); nativePause(); };
  video.play = () => { hive.direct.push('play'); return nativePlay(); };
  const player = {
    pause() { hive.calls.push('pause'); hive.state = 'paused'; nativePause(); },
    play() { hive.calls.push('play'); hive.state = 'playing'; return nativePlay(); },
    on() {},
    timeline: { info: { get playheadPositionMs() { return hive.playheadMs; }, programDurationMs: 5_400_000 } }
  };
  web.mediaPlayer = player;
  web.mediaElement = video;
  web.stateStore = { subscribe: () => () => {}, getState: () => ({ player: { extensions: { playback: { isPaused: hive.state === 'paused', currentState: hive.state.toUpperCase() } } } }) };
  hive.tick = ms => { if (hive.state === 'playing') hive.playheadMs += ms; };
  // The audio switch's reload: the element empties, then Hive resumes it from its own playhead if it believes it plays.
  hive.reload = () => {
    hive.reloads += 1;
    video.dispatchEvent(new Event('emptied'));
    video.dispatchEvent(new Event('loadedmetadata'));
    if (hive.state === 'playing') { hive.resumedFrom.push(hive.playheadMs); nativePlay(); }
  };
})()`;

async function open(test: TestContext, engine: 'chromium' | 'firefox'): Promise<Page> {
  const page = await (await browsers[engine].newContext(test, { viewport: { width: 1280, height: 800 } })).newPage();
  await page.route('https://www.disneyplus.com/**', route => route.fulfill({ contentType: 'text/html', body: HTML }));
  await page.goto(`https://www.disneyplus.com/pl-pl/play/${PLAY}`);
  await page.evaluate(fakeHive);
  await bootPlayer(page, { settings: { keepControlsVisible: true }, mainWorld: true });
  await page.evaluate('window.__hive.direct.length = 0; document.querySelector("video").play()');
  await page.waitForFunction(() => {
    const video = document.querySelector('video') as HTMLVideoElement;
    return video.readyState >= 2 && !video.paused;
  });
  await enterTheater(page);
  await page.evaluate('window.__hive.direct.length = 0');
  return page;
}

const hive = <T>(page: Page, expression: string): Promise<T> => page.evaluate(`(() => { const hive = window.__hive; return ${expression}; })()`);
const videoPaused = (page: Page): Promise<boolean> => page.evaluate('document.querySelector("video").paused');
/** The bar offers Play while paused and Pause while playing (the English test locale). */
async function waitForBar(page: Page, paused: boolean): Promise<void> {
  await page.waitForFunction(isPaused => {
    const label = document.querySelector('#theater-everywhere-ui')?.shadowRoot?.querySelector('.play-pause-btn')?.getAttribute('aria-label') ?? '';
    return isPaused ? /play/i.test(label) : /pause/i.test(label);
  }, paused);
}
const toggle = (page: Page, how: 'button' | 'space') => how === 'space' ? page.keyboard.press('Space') : page.locator('.play-pause-btn').click();

describe('Disney+ pause and play through Hive', () => {
  for (const engine of testEngines()) {
    for (const how of ['button', 'space'] as const) {
      it(`pauses and plays Hive itself, once per press, from the ${how} in ${engine}`, async t => {
        const page = await open(t, engine);
        await toggle(page, how);
        await page.waitForFunction('document.querySelector("video").paused');
        assert.deepEqual(await hive(page, '[hive.calls, hive.direct, hive.state]'), [['pause'], [], 'paused'], 'Hive paused; the element was left to it');
        await waitForBar(page, true);
        await toggle(page, how);
        await page.waitForFunction('!document.querySelector("video").paused');
        assert.deepEqual(await hive(page, '[hive.calls, hive.direct, hive.state]'), [['pause', 'play'], [], 'playing']);
        await waitForBar(page, false);
      });
    }

    it(`shows Disney's own pause and play on the bar in ${engine}`, async t => {
      const page = await open(t, engine);
      await page.evaluate('document.querySelector("disney-web-player").mediaPlayer.pause()');
      await waitForBar(page, true);
      await page.evaluate('document.querySelector("disney-web-player").mediaPlayer.play()');
      await waitForBar(page, false);
      assert.deepEqual(await hive(page, 'hive.direct'), [], 'the extension never touched the element');
    });

    it(`keeps the position through an audio switch after a pause, because Hive is paused too, in ${engine}`, async t => {
      const page = await open(t, engine);
      await toggle(page, 'button');
      await page.waitForFunction('document.querySelector("video").paused');
      await hive(page, 'hive.tick(75_000)');
      await hive(page, 'hive.reload()');
      assert.deepEqual(await hive(page, '[hive.playheadMs, hive.resumedFrom, hive.state]'), [32_000, [], 'paused'], 'no resume, no jump');
      assert.equal(await videoPaused(page), true);

      // The element-only pause the extension used to do: Hive keeps running and the reload resumes ahead of the pause point.
      await toggle(page, 'button');
      await page.waitForFunction('!document.querySelector("video").paused');
      await page.evaluate('window.__hive.state = "playing"; document.querySelector("video").pause()');
      await hive(page, 'hive.tick(75_000)');
      await hive(page, 'hive.reload()');
      assert.deepEqual(await hive(page, 'hive.resumedFrom'), [107_000], 'the old behavior moved the title 75 s');
    });

    it(`falls back to the element when Hive cannot be used, in ${engine}`, async t => {
      const page = await open(t, engine);
      // MAIN answers only the two actions; anything else a page sends is neither done nor cancelled.
      const answered = await page.evaluate(() => ['seek', { action: 'pause' }, null].map(detail =>
        window.dispatchEvent(new CustomEvent('theater-everywhere-disney-playback', { cancelable: true, detail }))));
      assert.deepEqual(answered, [true, true, true]);
      assert.deepEqual(await hive(page, '[hive.calls, hive.direct]'), [[], []]);
      // No pause method, then one that throws.
      await page.evaluate('window.__pause = document.querySelector("disney-web-player").mediaPlayer.pause; delete document.querySelector("disney-web-player").mediaPlayer.pause');
      await toggle(page, 'space');
      await page.waitForFunction('document.querySelector("video").paused');
      assert.deepEqual(await hive(page, '[hive.calls, hive.direct]'), [[], ['pause']]);
      await toggle(page, 'space');
      await page.waitForFunction('!document.querySelector("video").paused');
      await page.evaluate('document.querySelector("disney-web-player").mediaPlayer.pause = () => { throw new Error("reattaching"); }');
      await hive(page, 'hive.direct.length = 0');
      await toggle(page, 'button');
      await page.waitForFunction('document.querySelector("video").paused');
      assert.deepEqual(await hive(page, 'hive.direct'), ['pause']);
      await waitForBar(page, true);
    });

    it(`leaves Replay of an ended title and a disabled integration to the element in ${engine}`, async t => {
      const page = await open(t, engine);
      await page.evaluate('document.querySelector("video").pause()');
      await page.waitForFunction('document.querySelector("video").paused');
      await hive(page, 'hive.direct.length = 0');
      await page.evaluate('Object.defineProperty(document.querySelector("video"), "ended", { configurable: true, get: () => true })');
      await toggle(page, 'space');
      await page.waitForFunction('!document.querySelector("video").paused');
      assert.deepEqual(await hive(page, '[hive.calls, hive.direct]'), [[], ['play']], 'an ended title replays through the element');

      await page.evaluate('delete document.querySelector("video").ended; document.documentElement.setAttribute("data-te-disney-integration-off", "")');
      await hive(page, 'hive.direct.length = 0');
      await toggle(page, 'space');
      await page.waitForFunction('document.querySelector("video").paused');
      assert.deepEqual(await hive(page, '[hive.calls, hive.direct]'), [[], ['pause']], 'with Rich Theater Experience off, Hive is not touched');
    });
  }
});
