import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { PROVIDER_ENTRIES, bundleModules } from '../../test-utils/player-boot';
import { sharedTestBrowser } from '../../test-utils/test-browser';
import { selectTestEngines } from '../../test-utils/test-engines';

const chromiumBrowser = sharedTestBrowser(chromium);

// The YouTube source and the registered isolated hook (through the shared lookup and integration gate) with MAIN's
// listener, both worlds in one page as the fixture runtime shares them.
const bundle = bundleModules([
  ...PROVIDER_ENTRIES,
  "export { DisposableScope } from './core/disposable-scope';",
  "export { enabledProviderSource } from './providers/hook-sources';",
  "export { observeProviderDom } from './providers/dom-watch';",
  "export { youtubePlaylistPanel } from './providers/youtube/playlist-panel';",
  "export { playlistBar } from './test-utils/playlist-panel-fixture';",
  "export { providerOffAttribute } from './media-features/provider-flags';",
  "export { installYouTubePlaylist } from './providers/youtube/playlist-panel-main';"
], 'PlaylistTest');

const html = `<!doctype html><body>
  <ytd-watch-flexy>
    <div id="movie_player"><video></video></div>
    <ytd-playlist-panel-renderer><div id="items"></div></ytd-playlist-panel-renderer>
  </ytd-watch-flexy>
  <div id="panel"></div>
</body>`;

/** YouTube's panel model and rows as the probe recorded them on live watch pages (shape, not content). */
const fixture = `(() => {
  window.__clicks = [];
  window.__state = { video: 'b', list: 'PLfixture' };
  const player = document.getElementById('movie_player');
  player.getVideoData = () => ({ video_id: window.__state.video });
  // \`placeholder\`: the queue's first row, the video that was playing when the queue started: no link, no endpoint.
  window.__render = (ids, current, { setIds = {}, infinite = false, placeholder = false } = {}) => {
    const panel = document.querySelector('ytd-playlist-panel-renderer');
    const items = panel.querySelector('#items');
    items.replaceChildren();
    const list = window.__state.list;
    const contents = ids.map((id, i) => {
      const href = '/watch?v=' + id + '&list=' + list + '&index=' + (i + 1);
      const renderer = { videoId: id, playlistSetVideoId: setIds[id] || 'set-' + id, selected: i === current,
        title: { simpleText: 'Video ' + id.toUpperCase() }, shortBylineText: { runs: [{ text: 'Channel ' + id }] },
        lengthText: { simpleText: (i + 1) + ':0' + i, accessibility: { accessibilityData: { label: 'n' } } },
        // The queue numbers none of its rows; other lists number every row but the playing one.
        ...placeholder && i !== current ? {} : { indexText: { simpleText: i === current ? '▶' : String(i + 1) } },
        thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/' + id + '/default.jpg', width: 120, height: 90 },
          { url: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg', width: 336, height: 188 }] },
        navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: href } },
          watchEndpoint: { videoId: id, playlistId: list, index: i } } };
      if (id === 'x') renderer.thumbnail = { thumbnails: [{ url: 'https://tracker.example/x.jpg', width: 168 }] };
      const row = document.createElement('ytd-playlist-panel-video-renderer');
      row.data = renderer;
      if (placeholder && i === 0) {
        delete renderer.navigationEndpoint;
        delete renderer.selected;
      } else {
        const a = document.createElement('a');
        a.id = 'wc-endpoint';
        a.href = href;
        a.onclick = event => { event.preventDefault(); window.__clicks.push(a.getAttribute('href')); };
        row.append(a);
      }
      items.append(row);
      return { playlistPanelVideoRenderer: renderer };
    });
    // The queue's model has no owner and is titled "Queue".
    panel.data = { playlistId: list, ...placeholder ? { title: 'Queue' } : { title: 'Fixture list', ownerName: { simpleText: 'Owner' } },
      totalVideos: infinite ? undefined : ids.length, isInfinite: infinite, currentIndex: current, localCurrentIndex: current, contents };
  };
  window.__render(['a', 'b', 'c', 'x'], 1);
})()`;

async function setup(page: Page): Promise<void> {
  await page.route('https://www.youtube.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await page.goto('https://www.youtube.com/watch?v=b&list=PLfixture');
  await page.addScriptTag({ content: `${bundle}\nwindow.PlaylistTest = PlaylistTest;` });
  await page.evaluate(fixture);
  await page.evaluate(`(() => {
    PlaylistTest.installYouTubePlaylist();
    window.__source = PlaylistTest.youtubePlaylistPanel(document.querySelector('video'), PlaylistTest.observeProviderDom);
    // The bar's toggle, as controls.ts opens it through the registered hook.
    window.__control = PlaylistTest.enabledProviderSource('playlistPanel', document.querySelector('video'),
      PlaylistTest.playlistBar(new PlaylistTest.DisposableScope()));
    window.__closed = [];
    window.__open = () => {
      window.__scope = new PlaylistTest.DisposableScope();
      window.__source.mount(document.getElementById('panel'), window.__scope, restore => window.__closed.push(restore));
    };
  })()`);
}

type Row = { title: string; byline: string; current: boolean; image: string };
const rows = (page: Page): Promise<Row[]> => page.evaluate(`[...document.querySelectorAll('#panel .theater-playlist-row')].map(row => ({
  title: row.querySelector('.theater-playlist-title').textContent, byline: row.querySelector('.theater-playlist-byline').textContent,
  current: row.getAttribute('aria-current') === 'true', image: row.querySelector('img')?.getAttribute('src') ?? '' }))`);
const clickRow = (page: Page, index: number): Promise<void> =>
  page.evaluate(`document.querySelectorAll('#panel .theater-playlist-row')[${index}].click()`);

for (const [name, browserType] of selectTestEngines([['Chromium', chromium], ['Firefox', firefox]] as const, ([engine]) => engine)) {
  const shared = browserType === chromium ? chromiumBrowser : sharedTestBrowser(browserType);
  describe(`YouTube playlist panel (${name})`, () => {
    it('lists the native panel model, highlights the playing item and navigates through the row link', async t => {
      if (!existsSync(browserType.executablePath())) { t.skip('Browser not installed'); return; }
      const context = await shared.newContext(t);
      try {
        const page = await context.newPage();
        await setup(page);
        assert.equal(await page.evaluate('window.__source.available()'), true);
        assert.deepEqual(await page.evaluate(`(() => { window.__control.syncAvailability();
          return [window.__control.host.hidden, Boolean(window.__control.host.querySelector('button.theater-control-btn.theater-playlist-toggle'))]; })()`),
          [false, true]);
        await page.evaluate('window.__open()');
        const listed = await rows(page);
        assert.deepEqual(listed.map(row => [row.title, row.byline, row.current]),
          [['Video A', 'Channel a', false], ['Video B', 'Channel b', true], ['Video C', 'Channel c', false], ['Video X', 'Channel x', false]]);
        // The row-sized ytimg thumbnail; any other host's image is dropped.
        assert.equal(listed[0].image, 'https://i.ytimg.com/vi/a/hqdefault.jpg');
        assert.equal(listed[3].image, '');
        assert.equal(await page.textContent('#panel .theater-playlist-meta'), '\u2068Owner\u2069 · Video 2 of 4');
        // The playing item only closes the panel; another goes through YouTube's own row link. A click without a
        // pointer (detail 0) is a keyboard activation, which hands focus back to the toggle.
        await clickRow(page, 1);
        assert.deepEqual(await page.evaluate('window.__clicks'), []);
        await clickRow(page, 2);
        assert.deepEqual(await page.evaluate('window.__clicks'), ['/watch?v=c&list=PLfixture&index=3']);
        assert.deepEqual(await page.evaluate('window.__closed'), [true, true]);
      } finally { await context.close(); }
    });

    it('follows the host list while open, rejects stale rows and stops at the end of the opening', async t => {
      if (!existsSync(browserType.executablePath())) { t.skip('Browser not installed'); return; }
      const context = await shared.newContext(t);
      try {
        const page = await context.newPage();
        await setup(page);
        await page.evaluate('window.__open()');
        // YouTube's SPA step to the next item: new URL and current row, same list.
        await page.evaluate(`history.pushState(null, '', '/watch?v=c&list=PLfixture'); window.__state.video = 'c';
          window.__render(['a', 'b', 'c', 'x'], 2);`);
        await page.waitForFunction(`document.querySelectorAll('#panel .theater-playlist-row')[2]?.getAttribute('aria-current') === 'true'`);
        // The host replaces the occurrence of A behind an open row, and the click lands before the coalesced repaint:
        // that row no longer navigates, and the panel shows the live list instead.
        await page.evaluate(`window.__scope.dispose(); window.__open();
          window.__render(['a', 'b', 'c', 'x'], 2, { setIds: { a: 'moved' } });
          document.querySelectorAll('#panel .theater-playlist-row')[0].click();`);
        assert.deepEqual(await page.evaluate('window.__clicks'), []);
        await page.waitForFunction(`document.querySelectorAll('#panel .theater-playlist-row')[0]?.dataset.key.includes('moved')`);
        await clickRow(page, 0);
        assert.deepEqual(await page.evaluate('window.__clicks'), ['/watch?v=a&list=PLfixture&index=1']);
        // Disposing the opening removes the view and its observation.
        await page.evaluate('window.__scope.dispose()');
        assert.equal(await page.evaluate(`document.getElementById('panel').childElementCount`), 0);
        await page.evaluate(`window.__render(['a', 'b'], 0)`);
        await page.evaluate('new Promise(requestAnimationFrame)');
        assert.equal(await page.evaluate(`document.getElementById('panel').childElementCount`), 0);
      } finally { await context.close(); }
    });

    it('lists the queue on a watch page whose URL names no list, and follows it to the next item', async t => {
      if (!existsSync(browserType.executablePath())) { t.skip('Browser not installed'); return; }
      const context = await shared.newContext(t);
      try {
        const page = await context.newPage();
        await setup(page);
        // "Add to queue" on a watch page without a list: YouTube shows its panel ("Queue", a TLPQ id) while the URL
        // still has no \`list=\`, and the playing video is the queue's link-less first row (recorded live).
        // A plain video first: YouTube's panel is there but hidden, so the toggle is absent.
        await page.evaluate(`history.replaceState(null, '', '/watch?v=a'); document.querySelector('ytd-playlist-panel-renderer').hidden = true`);
        assert.equal(await page.evaluate('window.__control.syncAvailability(), window.__control.host.hidden'), true);
        // The viewer adds two videos to the queue: the panel appears, the URL still names no list.
        await page.evaluate(`window.__state = { video: 'a', list: 'TLPQfixture' }; window.__render(['a', 'b', 'c'], 0, { placeholder: true });
          document.querySelector('ytd-playlist-panel-renderer').hidden = false;`);
        assert.equal(await page.evaluate('window.__source.available()'), true);
        assert.equal(await page.evaluate('window.__control.syncAvailability(), window.__control.host.hidden'), false);
        await page.evaluate('window.__open()');
        assert.deepEqual((await rows(page)).map(row => [row.title, row.current]), [['Video A', true], ['Video B', false], ['Video C', false]]);
        // As in YouTube's own panel: no numbers on the queue's rows, "1 / 3" in the header.
        assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('#panel .theater-playlist-index')].map(cell => cell.textContent)`), ['', '', '']);
        assert.equal(await page.textContent('#panel .theater-playlist-meta'), 'Video 1 of 3');
        await clickRow(page, 1);
        assert.deepEqual(await page.evaluate('window.__clicks'), ['/watch?v=b&list=TLPQfixture&index=2']);
        // YouTube steps into the queue: the URL now names it and the next row is current.
        await page.evaluate(`history.pushState(null, '', '/watch?v=b&list=TLPQfixture&index=2'); window.__state.video = 'b';
          window.__render(['a', 'b', 'c'], 1, { placeholder: true });`);
        await page.waitForFunction(`document.querySelectorAll('#panel .theater-playlist-row')[1]?.getAttribute('aria-current') === 'true'`);
        assert.equal(await page.evaluate('window.__control.syncAvailability(), window.__control.host.hidden'), false);
        // Clearing the queue hides YouTube's panel again, and the toggle goes with it.
        await page.evaluate(`history.pushState(null, '', '/watch?v=b'); document.querySelector('ytd-playlist-panel-renderer').hidden = true`);
        assert.equal(await page.evaluate('window.__control.syncAvailability(), window.__control.host.hidden'), true);
      } finally { await context.close(); }
    });

    it('degrades to no panel without a list, with a hidden native panel and with the integration off', async t => {
      if (!existsSync(browserType.executablePath())) { t.skip('Browser not installed'); return; }
      const context = await shared.newContext(t);
      try {
        const page = await context.newPage();
        await setup(page);
        await page.evaluate(`document.querySelector('ytd-playlist-panel-renderer').hidden = true`);
        assert.equal(await page.evaluate('window.__source.available()'), false);
        assert.equal(await page.evaluate('window.__control.syncAvailability(), window.__control.host.hidden'), true);
        // A plain video: YouTube keeps its panel, hidden, on a watch page without a list.
        await page.evaluate(`history.replaceState(null, '', '/watch?v=b')`);
        assert.equal(await page.evaluate('window.__source.available()'), false);
        await page.evaluate(`document.querySelector('ytd-playlist-panel-renderer').hidden = false;
          history.replaceState(null, '', '/watch?v=b&list=PLfixture');
          document.documentElement.setAttribute(PlaylistTest.providerOffAttribute('youtube'), '')`);
        assert.equal(await page.evaluate('window.__source.available()'), false);
        await page.evaluate('window.__open()');
        assert.equal(await page.evaluate(`document.querySelector('#panel [role="status"]') !== null`), true);
        // A list the URL does not name is another player's model.
        await page.evaluate(`document.documentElement.removeAttribute(PlaylistTest.providerOffAttribute('youtube'));
          window.__scope.dispose(); history.replaceState(null, '', '/watch?v=b&list=PLother'); window.__open()`);
        assert.equal(await page.evaluate(`document.querySelector('#panel [role="status"]') !== null`), true);
      } finally { await context.close(); }
    });
  });
}
