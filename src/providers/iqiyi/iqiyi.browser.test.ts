import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { findPlaylistActions } from '../../playlist-nav';
import { sharedEngineBrowsers } from '../../test-utils/engine-browsers';
import { bundleModules } from '../../test-utils/player-boot';
import { testEngines } from '../../test-utils/test-engines';

import type { IqiyiAdapter } from './adapter';

const bundle = bundleModules([
  "export { IqiyiAdapter } from './providers/iqiyi/adapter';",
  "export { findPlaylistActions } from './playlist-nav';"
], 'IqiyiTest');
const browsers = sharedEngineBrowsers();
type Api = {
  IqiyiAdapter: typeof IqiyiAdapter;
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
<iqpdiv class="iqp-btn iqp-btn-next" data-player-hook="nextcontrol"></iqpdiv></iqpdiv></div></div>
<ul class="intl-episodes-list drama">
<li class="v-li drama selected"><a class="drama-item" href="//www.iq.com/play/spring-of-the-blade-episode-1-198yzaqjce8?lang=en_us">1</a></li>
<li class="v-li drama"><a class="drama-item" href="//www.iq.com${EPISODE_2}">2</a></li></ul>
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
});
