import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { findPlaylistActions } from '../../playlist-nav';
import { sharedEngineBrowsers } from '../../test-utils/engine-browsers';
import { bundleModules } from '../../test-utils/player-boot';
import { readStylesheet } from '../../test-utils/styles';
import { testEngines } from '../../test-utils/test-engines';

import type { IqiyiAdapter } from './adapter';
import type { readIqiyiCaptionLayout } from './captions';
import type { iqiyiWatchPlayback } from './watch-playback';

const bundle = bundleModules([
  "export { IqiyiAdapter } from './providers/iqiyi/adapter';",
  "export { readIqiyiCaptionLayout } from './providers/iqiyi/captions';",
  "export { iqiyiWatchPlayback } from './providers/iqiyi/watch-playback';",
  "export { findPlaylistActions } from './playlist-nav';"
], 'IqiyiTest');
const browsers = sharedEngineBrowsers();
type Api = {
  IqiyiAdapter: typeof IqiyiAdapter;
  readIqiyiCaptionLayout: typeof readIqiyiCaptionLayout;
  iqiyiWatchPlayback: typeof iqiyiWatchPlayback;
  findPlaylistActions: typeof findPlaylistActions;
};

const EPISODE_1 = 'https://www.iq.com/play/spring-of-the-blade-episode-1-198yzaqjce8?lang=en_us';
const EPISODE_2 = '/play/spring-of-the-blade-episode-2-1w9dte7osf8?lang=en_us';

// Structure recorded from an iq.com episode page: the heading holds the series link and the
// episode label as a bare text node, the episode list marks the playing item `selected`, and
// the custom-element player carries its own next control. og:title is marketing copy.
const PAGE = `<!doctype html><html><head>
<meta property="og:title" content="Spring of The Blade Episode 1– Download APP to Enjoy Now!">
<title>Watch the latest Spring of The Blade Episode 1 online – iQIYI | iQ.com</title></head><body>
<h1 class="intl-play-title"><a class="intl-album-title" href="//www.iq.com/album/spring-of-the-blade-2026-1nby7voujqx?lang=en_us"><span class="intl-album-title-word-wrap"><span>Spring of The Blade </span><span class="tips-wrap "><span class="tips-word">more info</span></span></span></a>Episode 1</h1>
<div class="intl-play-area"><div id="flashbox"><iqpdiv class="iqp-player-g iqp-player iqp-player-pc"><video></video>
<iqpdiv class="iqp-google-adcontainer"><video></video></iqpdiv>
<iqpdiv class="iqp-btn iqp-btn-next" data-player-hook="nextcontrol"></iqpdiv>
<iqpdiv class="iqp-pop-wrap iqp-pop-subtitle-lang"><iqpdiv data-player-hook="defaultBar" style="display: none;"><iqp class="iqp-txt-subtitle selected iqp-pop-txt" data-player-hook="cap_default">Default</iqp></iqpdiv>
<iqpdiv data-player-hook="captionBar"><iqpdiv class="iqp-pop-langSelect">
<iqp class="iqp-langlist-pop-txt " datalid="-1" datakey="close"><iqp><iqp>Off</iqp></iqp></iqp>
<iqp class="iqp-langlist-pop-txt selected" datalid="3" datakey="2"><iqp><iqp>English</iqp></iqp></iqp>
<iqp class="iqp-langlist-pop-txt " datalid="5" datakey="4"><iqp><iqp>Japanese</iqp><iqp class="iqp-langlist-source">(AI translation)</iqp></iqp></iqp>
</iqpdiv></iqpdiv></iqpdiv>
<iqpdiv class="iqp-pop-wrap iqp-pop-audio"><iqp class="iqp-langlist-pop-txt " datalid="3" datakey="0"><iqp><iqp>Mandarin (Original)</iqp></iqp></iqp></iqpdiv>
</iqpdiv></div></div>
<ul class="intl-episodes-list drama">
<li class="v-li drama selected"><a class="drama-item" rseat="1" href="//www.iq.com/play/spring-of-the-blade-episode-1-198yzaqjce8?lang=en_us">1</a></li>
<li class="v-li drama"><a class="drama-item" rseat="2" href="//www.iq.com${EPISODE_2}">2</a></li></ul>
</body></html>`;

for (const engine of testEngines()) describe(`${engine} iQIYI provider`, () => {
  it('reads the series title and episode label from the play heading, not page metadata', async t => {
    const page = await (await browsers[engine].newContext(t)).newPage();
    await page.route('https://www.iq.com/**', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
    await page.goto(EPISODE_1);
    await page.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
    const read = await page.evaluate(() => {
      const adapter = new (window as unknown as { IqiyiTest: Api }).IqiyiTest.IqiyiAdapter();
      return { title: adapter.getTitle(), subtitle: adapter.getSubtitle(), id: adapter.mediaId() };
    });
    assert.deepEqual(read, { title: 'Spring of The Blade', subtitle: 'Episode 1', id: '198yzaqjce8' });
  });

  it('rejects a heading left over from the previous episode and follows the SPA change', async t => {
    const page = await (await browsers[engine].newContext(t)).newPage();
    await page.route('https://www.iq.com/**', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
    await page.goto(EPISODE_1);
    await page.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
    const report = await page.evaluate(async episode2 => {
      const adapter = new (window as unknown as { IqiyiTest: Api }).IqiyiTest.IqiyiAdapter();
      let notify = () => {};
      const stop = adapter.observeTitle(() => notify());
      const until = async (ready: () => boolean) => { while (!ready()) await new Promise<void>(resolve => { notify = resolve; }); };
      // The URL changes first: the heading and highlighted episode still describe episode 1.
      history.pushState(null, '', episode2);
      const stale = adapter.getTitle();
      // The heading catches up before the episode list does: still not the URL's episode.
      document.querySelector('h1.intl-play-title')!.lastChild!.textContent = 'Episode 2';
      const headingOnly = adapter.getTitle();
      document.querySelector('li.selected')!.classList.remove('selected');
      document.querySelectorAll('li.v-li')[1].classList.add('selected');
      await until(() => adapter.getSubtitle() === 'Episode 2');
      const result = { stale, headingOnly, title: adapter.getTitle(), subtitle: adapter.getSubtitle(), id: adapter.mediaId() };
      stop();
      return result;
    }, EPISODE_2);
    assert.deepEqual(report, { stale: null, headingOnly: null, title: 'Spring of The Blade', subtitle: 'Episode 2', id: '1w9dte7osf8' });
  });

  it('offers only Next, through the native control, and drops it when the player hides it', async t => {
    const page = await (await browsers[engine].newContext(t)).newPage();
    await page.route('https://www.iq.com/**', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
    await page.goto(EPISODE_1);
    await page.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
    const report = await page.evaluate(() => {
      const api = (window as unknown as { IqiyiTest: Api }).IqiyiTest;
      const video = document.querySelector('video')!;
      const next = document.querySelector<HTMLElement>('.iqp-btn-next')!;
      let clicks = 0;
      next.addEventListener('click', () => { clicks++; });
      const shown = api.findPlaylistActions(document, video);
      shown.find(action => action.direction === 'next')?.activate();
      next.style.display = 'none';
      const hidden = api.findPlaylistActions(document, video);
      return { shown: shown.map(action => action.direction), clicks, hidden: hidden.map(action => action.direction) };
    });
    assert.deepEqual(report, { shown: ['next'], clicks: 1, hidden: [] });
  });

  it('lists the host menu languages and selects them through the host menu item', async t => {
    const page = await (await browsers[engine].newContext(t)).newPage();
    await page.route('https://www.iq.com/**', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
    await page.goto(EPISODE_1);
    await page.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
    const report = await page.evaluate(async () => {
      const adapter = new (window as unknown as { IqiyiTest: Api }).IqiyiTest.IqiyiAdapter();
      const clicks: string[] = [];
      for (const item of document.querySelectorAll('.iqp-pop-subtitle-lang .iqp-langlist-pop-txt')) {
        item.addEventListener('click', () => clicks.push(item.getAttribute('datalid')!));
      }
      const tracks = await adapter.listCaptionTracks();
      const english = await adapter.activateCaptionTrack('iqiyi:3');
      const japanese = await adapter.activateCaptionTrack('iqiyi:5');
      const off = await adapter.activateCaptionTrack(null);
      const unknown = await adapter.activateCaptionTrack('iqiyi:99');
      // The audio menu reuses the item class and must never be treated as a subtitle.
      const audio = await adapter.activateCaptionTrack('iqiyi:0');
      document.querySelector('[datalid="3"]')!.remove();
      const detached = await adapter.activateCaptionTrack('iqiyi:3');
      return { tracks, results: [english, japanese, off, unknown, audio, detached].map(r => [r.status, r.delivery]), clicks, probe: await adapter.probe() };
    });
    assert.deepEqual(report.tracks, [
      { id: 'iqiyi:3', language: 'en', label: 'English', kind: 'subtitles', source: 'iqiyi', delivery: 'host' },
      { id: 'iqiyi:5', language: 'ja', label: 'Japanese', kind: 'subtitles', source: 'iqiyi', delivery: 'host', autoGenerated: true }
    ]);
    assert.deepEqual(report.results, [['active', 'host'], ['active', 'host'], ['off', 'none'], ['failed', 'none'], ['failed', 'none'], ['failed', 'none']]);
    assert.deepEqual(report.clicks, ['3', '5', '-1']);
    assert.equal(report.probe.captions, true);
  });

  it('measures only the painted cue lines for the host-caption dock', async t => {
    const page = await (await browsers[engine].newContext(t)).newPage();
    await page.route('https://www.iq.com/**', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
    await page.goto(EPISODE_1);
    await page.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
    const report = await page.evaluate(() => {
      const api = (window as unknown as { IqiyiTest: Api }).IqiyiTest;
      const player = document.querySelector('.iqp-player')!;
      const none = api.readIqiyiCaptionLayout();
      const cue = (box: string, hidden = false) => {
        const element = document.createElement('div');
        element.className = 'iqp-subtitle';
        element.innerHTML = `<div data-player-hook="subtitleelem" style="position:absolute;${box}${hidden ? ';display:none' : ''}">line</div>`;
        player.append(element);
      };
      cue('left:100px;top:300px;width:300px;height:30px');
      cue('left:120px;top:340px;width:260px;height:30px');
      cue('left:0;top:0;width:900px;height:900px', true);
      return { none, shown: api.readIqiyiCaptionLayout() };
    });
    assert.equal(report.none, null);
    assert.deepEqual(report.shown, { width: 300, height: 70, lineHeight: 30, rows: 2 });
  });

  it('reads the intro and outro windows of the current episode only', async t => {
    const page = await (await browsers[engine].newContext(t)).newPage();
    await page.route('https://www.iq.com/**', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
    await page.goto(EPISODE_1);
    await page.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
    const report = await page.evaluate(async episode2 => {
      const snapshot: { tvid: string; duration: number; introEnd: number | null; outroStart: number | null; outroEnd: number | null } = { tvid: '4546375215960300', duration: 2569, introEnd: 14, outroStart: 2415, outroEnd: 2568 };
      let current: typeof snapshot | null = snapshot;
      let requests = 0;
      // Stands in for the MAIN-world reader, which answers with the page's play-info.
      window.addEventListener('theater-everywhere-media-probe', event => {
        requests++;
        const { requestId } = JSON.parse(String((event as CustomEvent<string>).detail));
        window.dispatchEvent(new CustomEvent('theater-everywhere-media-probe-result', { detail: { requestId, iqiyi: current } }));
      });
      const video = document.querySelector('video')!;
      Object.defineProperty(video, 'duration', { configurable: true, value: 2570 });
      const adapter = new (window as unknown as { IqiyiTest: Api }).IqiyiTest.IqiyiAdapter(video);
      const first = (await adapter.getChapters()).map(c => [c.title, c.start, c.end]);
      await adapter.getChapters();
      const cached = requests;
      // The next episode: the URL changes while the page still holds the previous play-info.
      history.pushState(null, '', episode2);
      Object.defineProperty(video, 'duration', { configurable: true, value: 1320 });
      const stale = (await adapter.reload().then(() => adapter.getChapters())).length;
      current = { ...snapshot, tvid: '4546375215960301', duration: 1319, introEnd: 10, outroStart: null, outroEnd: null };
      await adapter.reload();
      const next = (await adapter.getChapters()).map(c => [c.title, c.start, c.end]);
      return { first, cached, stale, next };
    }, EPISODE_2);
    assert.deepEqual(report.first, [['Intro', 0, 14], ['Outro', 2415, 2568]]);
    assert.equal(report.cached, 1, 'one MAIN read per episode');
    assert.equal(report.stale, 0);
    assert.deepEqual(report.next, [['Intro', 0, 10]]);
  });

  it('confirms only the episode player for AutoTheater, rejecting ads, duplicates, live and a stale highlight', async t => {
    const page = await (await browsers[engine].newContext(t)).newPage();
    await page.route('https://www.iq.com/**', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
    await page.goto(EPISODE_1);
    await page.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
    const report = await page.evaluate(() => {
      const { iqiyiWatchPlayback } = (window as unknown as { IqiyiTest: Api }).IqiyiTest;
      const main = (id = '198yzaqjce8') => iqiyiWatchPlayback.mainVideo(document, id) === document.querySelector('.iqp-player > video');
      const accepted = main();
      const adOnly = document.querySelector('.iqp-google-adcontainer video') !== iqiyiWatchPlayback.mainVideo(document, '198yzaqjce8');
      const otherEpisode = main('1w9dte7osf8');
      const video = document.querySelector('.iqp-player > video')!;
      Object.defineProperty(video, 'duration', { configurable: true, value: Infinity });
      const live = main();
      Object.defineProperty(video, 'duration', { configurable: true, value: 2570 });
      const second = document.querySelector('.iqp-player')!.cloneNode(true) as Element;
      document.body.append(second);
      const twoPlayers = main();
      second.remove();
      const preparing = iqiyiWatchPlayback.preparingVideo?.(document, '198yzaqjce8') === video;
      return { accepted, adOnly, otherEpisode, live, twoPlayers, preparing };
    });
    assert.deepEqual(report, { accepted: true, adOnly: true, otherEpisode: false, live: false, twoPlayers: false, preparing: true });
  });

  it('offers Previous from the episode list, skipping trailers, and none on the first episode', async t => {
    const page = await (await browsers[engine].newContext(t)).newPage();
    await page.route('https://www.iq.com/**', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
    await page.goto(EPISODE_1);
    await page.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
    const report = await page.evaluate(() => {
      const api = (window as unknown as { IqiyiTest: Api }).IqiyiTest;
      const video = document.querySelector('video')!;
      const directions = () => api.findPlaylistActions(document, video).map(action => action.direction);
      const first = directions();
      // Episode 2 is playing; a trailer entry sits between it and episode 1 on the real list.
      const list = document.querySelector('ul')!;
      const trailer = document.createElement('li');
      trailer.className = 'v-li drama';
      trailer.innerHTML = '<a rseat="trailer" href="//www.iq.com/play/trailer-abc">1</a>';
      list.children[0].after(trailer);
      list.children[0].classList.remove('selected');
      list.children[2].classList.add('selected');
      let clicked = '';
      list.children[0].querySelector('a')!.addEventListener('click', event => { event.preventDefault(); clicked = 'episode 1'; });
      trailer.querySelector('a')!.addEventListener('click', event => { event.preventDefault(); clicked = 'trailer'; });
      const second = api.findPlaylistActions(document, video);
      second.find(action => action.direction === 'previous')?.activate();
      return { first, second: second.map(action => action.direction), clicked };
    });
    assert.deepEqual(report, { first: ['next'], second: ['previous', 'next'], clicked: 'episode 1' });
  });

  it('gives the collapsed player the viewport box and raises the host cues, in theater only', async t => {
    const page = await (await browsers[engine].newContext(t, { viewport: { width: 800, height: 600 } })).newPage();
    await page.route('https://www.iq.com/**', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
    await page.goto(EPISODE_1);
    await page.addStyleTag({ content: readStylesheet(new URL('./presentation.css', import.meta.url)) });
    const read = () => page.evaluate(() => {
      const player = document.querySelector('.iqp-player')!;
      const cue = document.createElement('div');
      cue.className = 'iqp-subtitle';
      player.append(cue);
      const box = player.getBoundingClientRect();
      const result = { position: getComputedStyle(player).position, size: [box.width, box.height], cueZ: getComputedStyle(cue).zIndex };
      cue.remove();
      return result;
    });
    const page_ = await read();
    await page.evaluate(() => document.documentElement.classList.add('theater-everywhere-html-active'));
    const theater = await read();
    assert.notEqual(page_.position, 'fixed');
    assert.notEqual(page_.cueZ, '2147483647');
    assert.deepEqual(theater, { position: 'fixed', size: [800, 600], cueZ: '2147483647' });
  });
});
