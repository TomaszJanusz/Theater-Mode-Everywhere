import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import type { Page } from 'playwright';

import type { requestPageFetch } from '../../media-features/probe';
import type { findPlaylistActions } from '../../playlist-nav';
import type { createWorldMessage } from '../../protocol/world-messages';
import { sharedEngineBrowsers } from '../../test-utils/engine-browsers';
import { bundleModules } from '../../test-utils/player-boot';
import { testEngines } from '../../test-utils/test-engines';
import type { serviceElementToken } from '../native-service-actions';

import type { SoopAdapter } from './adapter';
import type { createSoopServiceActions } from './service-actions';
import type { soopWatchPlayback } from './watch-playback';

const bundle = bundleModules([
  "export { exposeFixtureRuntime } from './test-utils/provider-runtime';",
  "export { requestPageFetch } from './media-features/probe';",
  "export { serviceElementToken } from './providers/native-service-actions';",
  "export { SoopAdapter } from './providers/soop/adapter';",
  "export { createSoopServiceActions } from './providers/soop/service-actions';",
  "export { soopWatchPlayback } from './providers/soop/watch-playback';",
  "export { findPlaylistActions } from './playlist-nav';",
  "export { createWorldMessage } from './protocol/world-messages';"
], 'SoopTest');
const provider = bundleModules(["import './providers/soop/isolated';"]);
const browsers = sharedEngineBrowsers();
type Api = {
  requestPageFetch: typeof requestPageFetch;
  serviceElementToken: typeof serviceElementToken;
  SoopAdapter: typeof SoopAdapter;
  createSoopServiceActions: typeof createSoopServiceActions;
  soopWatchPlayback: typeof soopWatchPlayback;
  findPlaylistActions: typeof findPlaylistActions;
  createWorldMessage: typeof createWorldMessage;
};
declare global { interface Window { SoopTest: Api; settleStorage(): Promise<unknown> } }

const LIVE = 'https://play.sooplive.com/battleland/297994793';
const VOD = 'https://vod.sooplive.com/player/211006561';

// Fixture evidence: the streamer block under the player as recorded on play.sooplive.com and vod.sooplive.com
// (2026-11-21): the logo links to the station, the nickname follows, the sidebar lists other streamers' logos.
const info = (station: string, nickname: string) => `<div class="wrapping player_bottom"><div class="broadcast_information">
<div class="column" number="1"><div class="thumbnail_box live" id="bjThumbnail"><a class="thumb" href="https://www.sooplive.com/station/${station}" target="_blank">
<img src="https://stimg.sooplive.com/LOGO/${station.slice(0, 2)}/${station}/${station}.jpg" class="thum"></a></div>
<div class="nickname"><a id="infoNickName" data-bj_id="${station}">${nickname}</a></div></div></div></div>
<ul class="sidebar"><li><a href="https://www.sooplive.com/station/other"><img src="https://stimg.sooplive.com/LOGO/ot/other/m/other.webp"></a></li></ul>`;

// Structure recorded from sooplive.com. A live page fills `#broadTitle` after load and holds the
// stream in `video#livePlayer`; a recording's title is `.broadcast_title`, its stream `video#video`.
// The ad element and the pre-agreement placeholder are separate video elements.
const LIVE_PAGE = `<!doctype html><body><div id="webplayer"><div id="player" class="play_start">
<div id="videoLayer"><video id="livePlayer" class="af_video"></video></div></div></div>
<h1 id="broadTitle" class="title"></h1>${info('battleland', 'battleland')}</body>`;
const VOD_PAGE = `<!doctype html><body><div id="webplayer"><div id="player" class="video">
<video id="video" class="af_video"></video><video id="adVideo" class="af_video"></video>
<button class="play prev" style="display:none">Previous</button><button class="play next"></button>
<div class="message_player_wrap"><div class="prev_next_play" style="display:none"><a href="/player/211006562"><span class="thumb"></span><div><strong>Next video</strong><p>Another week</p></div></a><button class="close">Close</button></div></div>
</div></div><div class="broadcast_title">[ENG/한] ANOTHER DAY</div>${info('snapgg', '#SNAP')}</body>`;

/**
 * Extension sync storage for the page: `set` notifies like the browser, and `settleStorage` resolves once every read
 * started so far has been answered and its reader has applied it (readers apply right after their read resolves).
 */
function installStorage(sync: Record<string, unknown>) {
  const listeners = new Set<(changes: Record<string, { newValue: unknown }>, area: string) => void>();
  const reads: Promise<unknown>[] = [];
  const storage = {
    sync: {
      get: (keys: string | string[]) => {
        const read = Promise.resolve(Object.fromEntries([keys].flat().map(key => [key, sync[key]])));
        reads.push(read);
        return read;
      },
      set: async (values: Record<string, unknown>) => {
        Object.assign(sync, values);
        const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }]));
        for (const listener of [...listeners]) listener(changes, 'sync');
      }
    },
    onChanged: { addListener: listeners.add.bind(listeners), removeListener: listeners.delete.bind(listeners) }
  };
  Object.defineProperty(window, 'chrome', { configurable: true, value: { ...(window as { chrome?: object }).chrome, storage } });
  window.settleStorage = () => Promise.all(reads).then(() => Promise.resolve());
}

async function open(t: TestContext, engine: keyof typeof browsers, url: string, body: string, sync: Record<string, unknown> = {}): Promise<Page> {
  const page = await (await browsers[engine].newContext(t)).newPage();
  await page.route('https://*.sooplive.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body }));
  await page.goto(url);
  // tsx names nested callbacks with __name; keep that helper inside the page.
  await page.evaluate(`window.__name = fn => fn; (${installStorage.toString()})(${JSON.stringify(sync)})`);
  await page.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
  await page.evaluate("SoopTest.exposeFixtureRuntime('isolated');");
  await page.addScriptTag({ content: provider });
  return page;
}

for (const engine of testEngines()) describe(`${engine} SOOP provider`, () => {
  it('reads the broadcast title once the page has filled it, and the recording title on VOD pages', async t => {
    const live = await open(t, engine, LIVE, LIVE_PAGE);
    const report = await live.evaluate(async () => {
      const adapter = new window.SoopTest.SoopAdapter(null, window.SoopTest.requestPageFetch);
      const empty = adapter.getTitle();
      let notify = () => {};
      const stop = adapter.observeTitle(() => notify());
      document.getElementById('broadTitle')!.textContent = '  PLAY LIVE  \n now ';
      while (adapter.getTitle() === null) await new Promise<void>(resolve => { notify = resolve; });
      stop();
      await window.settleStorage();
      return { empty, title: adapter.getTitle(), subtitle: adapter.getSubtitle(), id: adapter.mediaId() };
    });
    assert.deepEqual(report, { empty: null, title: 'PLAY LIVE now', subtitle: null, id: 'live:battleland/297994793' });
    const vod = await open(t, engine, VOD, VOD_PAGE);
    assert.deepEqual(await vod.evaluate(async () => {
      const adapter = new window.SoopTest.SoopAdapter(null, window.SoopTest.requestPageFetch);
      await window.settleStorage();
      return [adapter.getTitle(), adapter.getSubtitle(), adapter.mediaId()];
    }), ['[ENG/한] ANOTHER DAY', null, 'vod:211006561']);
    const channel = await open(t, engine, 'https://play.sooplive.com/battleland', LIVE_PAGE);
    assert.deepEqual(await channel.evaluate(() => {
      document.getElementById('broadTitle')!.textContent = 'x';
      const adapter = new window.SoopTest.SoopAdapter(null, window.SoopTest.requestPageFetch);
      return [adapter.getTitle(), adapter.mediaId()];
    }), [null, null], 'a bare channel address is not a watch route');
  });

  it('names the streamer in the byline from the block under the player, and keeps the subtitle when it cannot', async t => {
    const live = await open(t, engine, LIVE, LIVE_PAGE);
    const read = () => live.evaluate(async () => {
      const adapter = new window.SoopTest.SoopAdapter(null, window.SoopTest.requestPageFetch);
      document.getElementById('broadTitle')!.textContent = 'PLAY LIVE';
      // The byline switches load first; until then the streamer stays in the title.
      await window.settleStorage();
      return { subtitle: adapter.getSubtitle(), authors: adapter.getAuthors() };
    });
    assert.deepEqual(await read(), { subtitle: null, authors: [{
      id: 'battleland', name: 'battleland', url: 'https://www.sooplive.com/station/battleland',
      avatarUrl: 'https://stimg.sooplive.com/LOGO/ba/battleland/battleland.jpg', verified: false, stat: null
    }] });
    // Another streamer's block (the page has not caught up with the URL yet) names nobody; the nickname stays.
    await live.evaluate(() => { document.querySelector<HTMLAnchorElement>('.broadcast_information a.thumb')!.href = 'https://www.sooplive.com/station/other'; });
    assert.deepEqual(await read(), { subtitle: 'battleland', authors: null });
    const vod = await open(t, engine, VOD, VOD_PAGE);
    assert.deepEqual(await vod.evaluate(async () => {
      const adapter = new window.SoopTest.SoopAdapter(null, window.SoopTest.requestPageFetch);
      await window.settleStorage();
      const named = adapter.getAuthors()?.map(author => [author.id, author.name, author.url]);
      document.querySelector('.broadcast_information a.thumb')!.setAttribute('href', 'https://evil.test/station/snapgg');
      return { named, foreign: adapter.getAuthors(), subtitle: adapter.getSubtitle() };
    }), { named: [['snapgg', '#SNAP', 'https://www.sooplive.com/station/snapgg']], foreign: null, subtitle: '#SNAP' });
  });

  it('keeps the streamer in the title while either byline switch is off, and follows both live', async t => {
    const live = await open(t, engine, LIVE, LIVE_PAGE, { authorByline: false });
    assert.deepEqual(await live.evaluate(async () => {
      document.getElementById('broadTitle')!.textContent = 'PLAY LIVE';
      const adapter = new window.SoopTest.SoopAdapter(null, window.SoopTest.requestPageFetch);
      let changes = 0;
      const stop = adapter.observeTitle(() => changes++);
      await window.settleStorage();
      const steps: unknown[] = [];
      const step = (label: string) => steps.push([label, adapter.getSubtitle(), adapter.getAuthors()?.length ?? 0]);
      step('global off');
      const before = changes;
      await chrome.storage.sync.set({ authorByline: true });
      step('global on');
      await chrome.storage.sync.set({ providerSettings: { soop: { showAuthor: false } } });
      step('SOOP off');
      await chrome.storage.sync.set({ providerSettings: { soop: { showAuthor: true } } });
      step('both on');
      steps.push(['notified', changes - before]);
      stop();
      adapter.dispose();
      await chrome.storage.sync.set({ authorByline: false });
      steps.push(['after dispose', changes - before]);
      return steps;
    }), [
      ['global off', 'battleland', 1],
      ['global on', null, 1],
      ['SOOP off', 'battleland', 1],
      ['both on', null, 1],
      ['notified', 3],
      ['after dispose', 3]
    ]);
  });

  it('requests the recording chapters once, and rejects an answer for another recording', async t => {
    const page = await open(t, engine, VOD, VOD_PAGE);
    const report = await page.evaluate(async () => {
      const { createWorldMessage, SoopAdapter } = window.SoopTest;
      const urls: string[] = [];
      let body = JSON.stringify({ result: 1, data: [{ title: 'Intro', time_sec: 0 }, { title: 'Game two', time_sec: 600 }] });
      let during: (() => void) | null = null;
      // Stands in for the MAIN-world page-fetch broker.
      window.addEventListener('message', event => {
        const message = event.data as { type?: string; requestId: string; nonce: string; origin: string; payload: { url: string } } | null;
        if (message?.type !== 'PAGE_FETCH') return;
        urls.push(message.payload.url);
        during?.();
        event.ports[0].postMessage(createWorldMessage('PAGE_FETCH_RESULT', { ok: true, body }, message.requestId, message.nonce, message.origin));
      });
      const video = document.querySelector<HTMLVideoElement>('video#video')!;
      Object.defineProperty(video, 'duration', { configurable: true, value: 1159.2 });
      const adapter = new SoopAdapter(video, window.SoopTest.requestPageFetch);
      const first = (await adapter.getChapters()).map(c => [c.title, c.start, c.end]);
      await adapter.getChapters();
      const cached = urls.length;
      // The viewer moves to another recording while the request is in flight.
      await adapter.reload();
      during = () => history.pushState(null, '', '/player/211006999');
      const stale = (await adapter.getChapters()).length;
      return { first, cached, urls, stale, probe: (await adapter.probe()).chapters };
    });
    assert.deepEqual(report.first, [['Intro', 0, 600], ['Game two', 600, 1159.2]]);
    assert.equal(report.cached, 1, 'one request per recording');
    assert.equal(report.urls[0], 'https://stbbs.sooplive.com/api/chapter/Controllers/ChapterListController.php?nTitleNo=211006561&szFileType=REVIEW');
    assert.equal(report.stale, 0);
    const live = await open(t, engine, LIVE, LIVE_PAGE);
    assert.equal(await live.evaluate(async () => (await new window.SoopTest.SoopAdapter(document.querySelector('video'), window.SoopTest.requestPageFetch).getChapters()).length), 0, 'a live broadcast has no chapters');
  });

  it('confirms only the streamed content video for AutoTheater', async t => {
    const live = await open(t, engine, LIVE, LIVE_PAGE);
    const liveReport = await live.evaluate(async () => {
      const { soopWatchPlayback } = window.SoopTest;
      const video = document.querySelector<HTMLVideoElement>('video#livePlayer')!;
      const identity = 'live:battleland/297994793';
      const confirmed = () => soopWatchPlayback.mainVideo(document, identity) === video;
      // Before the player terms are accepted the element holds a placeholder data: source.
      const load = (src: string) => new Promise<void>(resolve => { video.addEventListener('loadstart', () => resolve(), { once: true }); video.src = src; });
      await load('data:video/mp4;base64,AAAA');
      Object.defineProperty(video, 'duration', { configurable: true, value: Infinity });
      const placeholder = confirmed();
      await load(URL.createObjectURL(new Blob(['x'])));
      const streaming = confirmed();
      const otherBroadcast = soopWatchPlayback.mainVideo(document, 'live:battleland/1') === video;
      const vodIdentity = soopWatchPlayback.mainVideo(document, 'vod:211006561') === video;
      Object.defineProperty(video, 'duration', { configurable: true, value: 600 });
      const finiteOnLive = confirmed();
      Object.defineProperty(video, 'duration', { configurable: true, value: Infinity });
      const second = document.createElement('video');
      second.id = 'livePlayer';
      document.querySelector('#player')!.append(second);
      return { placeholder, streaming, otherBroadcast, vodIdentity, finiteOnLive, twoPlayers: confirmed(), preparing: soopWatchPlayback.preparingVideo === soopWatchPlayback.mainVideo };
    });
    assert.deepEqual(liveReport, { placeholder: false, streaming: true, otherBroadcast: false, vodIdentity: false, finiteOnLive: false, twoPlayers: false, preparing: true });
    const vod = await open(t, engine, VOD, VOD_PAGE);
    assert.deepEqual(await vod.evaluate(async () => {
      const { soopWatchPlayback } = window.SoopTest;
      const main = document.querySelector<HTMLVideoElement>('video#video')!;
      const ad = document.querySelector<HTMLVideoElement>('video#adVideo')!;
      const load = (video: HTMLVideoElement, src: string) => new Promise<void>(resolve => { video.addEventListener('loadstart', () => resolve(), { once: true }); video.src = src; });
      await load(main, URL.createObjectURL(new Blob(['x'])));
      await load(ad, URL.createObjectURL(new Blob(['y'])));
      Object.defineProperty(main, 'duration', { configurable: true, value: 1159 });
      Object.defineProperty(ad, 'duration', { configurable: true, value: 1159 });
      return [soopWatchPlayback.mainVideo(document, 'vod:211006561') === main, soopWatchPlayback.mainVideo(document, 'live:battleland/211006561')];
    }), [true, null]);
  });

  it('offers the recording player Previous and Next, drops a hidden one, and nothing on live', async t => {
    const vod = await open(t, engine, VOD, VOD_PAGE);
    const report = await vod.evaluate(() => {
      const { findPlaylistActions } = window.SoopTest;
      const video = document.querySelector('video')!;
      const directions = () => findPlaylistActions(document, video).map(action => action.direction);
      const first = directions();
      let clicks = '';
      for (const direction of ['prev', 'next']) document.querySelector(`button.play.${direction}`)!.addEventListener('click', () => { clicks += direction; });
      const prev = document.querySelector<HTMLElement>('button.play.prev')!;
      prev.style.display = '';
      const both = findPlaylistActions(document, video);
      both.forEach(action => action.activate());
      document.querySelector<HTMLElement>('button.play.next')!.style.display = 'none';
      return { first, both: both.map(action => action.direction), clicks, afterHide: directions() };
    });
    assert.deepEqual(report, { first: ['next'], both: ['previous', 'next'], clicks: 'prevnext', afterHide: ['previous'] });
    const live = await open(t, engine, LIVE, LIVE_PAGE);
    assert.deepEqual(await live.evaluate(() => window.SoopTest.findPlaylistActions(document, document.querySelector('video')).map(a => a.direction)), []);
  });

  it('exposes the "next video" countdown card as an action only while it counts down', async t => {
    const page = await open(t, engine, VOD, VOD_PAGE);
    const report = await page.evaluate(() => {
      const source = window.SoopTest.createSoopServiceActions({ elementToken: window.SoopTest.serviceElementToken });
      const card = document.querySelector<HTMLElement>('.prev_next_play')!;
      const link = card.querySelector('a')!;
      const strong = card.querySelector('strong')!;
      let clicks = 0;
      link.addEventListener('click', event => { event.preventDefault(); clicks++; });
      const hidden = source.read().length;
      card.style.display = 'flex';
      const preCountdown = source.read().length;
      strong.textContent = 'Play in 3 sec';
      const [action] = source.read();
      strong.textContent = 'Play in 1 sec';
      const [later] = source.read();
      const progress = [action.progress, later.progress, source.readProgress?.(action.id)];
      const activated = source.activate(action.id);
      card.style.display = 'none';
      return { hidden, preCountdown, label: action.label, stableId: action.id === later.id, progress, activated, clicks, staleActivate: source.activate(action.id), staleProgress: source.readProgress?.(action.id) };
    });
    assert.deepEqual(report, {
      hidden: 0, preCountdown: 0, label: 'Play in 3 sec', stableId: true, progress: [0.4, 0.8, 0.8],
      activated: true, clicks: 1, staleActivate: false, staleProgress: null
    });
    const live = await open(t, engine, LIVE, LIVE_PAGE);
    assert.equal(await live.evaluate(() => window.SoopTest.createSoopServiceActions({ elementToken: window.SoopTest.serviceElementToken }).read().length), 0);
  });
});
