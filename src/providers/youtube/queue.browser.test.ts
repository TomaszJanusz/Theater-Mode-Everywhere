import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { chromium, firefox, type Page } from 'playwright';

const require = createRequire(import.meta.url);
const esbuild = require(createRequire(require.resolve('vite')).resolve('esbuild')) as {
  buildSync(options: Record<string, unknown>): { outputFiles: Array<{ text: string }> };
};
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = esbuild.buildSync({
  stdin: {
    contents: "export { findPlaylistActions } from './playlist-nav'; export { installYouTubeQueueNavigation } from './providers/youtube/queue-main';",
    resolveDir: source, loader: 'ts'
  },
  bundle: true, write: false, format: 'iife', globalName: 'QueueTest', platform: 'browser', target: 'es2022'
}).outputFiles[0].text;

const html = `<!doctype html><body>
  <ytd-watch-flexy>
    <div id="movie_player"><video></video>
      <button class="ytp-prev-button" data-tooltip-text="Native previous" data-preview="https://i.ytimg.com/vi/a/default.jpg">Previous</button>
      <button class="ytp-next-button" data-tooltip-text="Native next" data-preview="https://i.ytimg.com/vi/c/default.jpg">Next</button>
    </div>
    <ytd-playlist-panel-renderer collapsed style="visibility:hidden;opacity:0;pointer-events:none">
      <div id="items" style="display:none"></div>
    </ytd-playlist-panel-renderer>
  </ytd-watch-flexy>
</body>`;

const fixture = `(() => {
  window.__clicks = [];
  window.__state = { video: 'b', queueId: 'PLfixture', sequence: ['a', 'b', 'c'], index: 1 };
  const player = document.getElementById('movie_player');
  player.getVideoData = () => ({video_id: window.__state.video});
  player.getPlaylist = () => window.__state.sequence;
  player.getPlaylistIndex = () => window.__state.index;
  player.getPlaylistId = () => window.__state.queueId;
  document.querySelectorAll('#movie_player button').forEach(b => b.onclick = () => window.__clicks.push(b.textContent));
  window.__render = (ids, current, {placeholder=false, unavailable=-1, continuation=false}={}) => {
    const panel = document.querySelector('ytd-playlist-panel-renderer');
    const items = panel.querySelector('#items');
    items.replaceChildren();
    const contents = ids.map((id, i) => {
      const renderer = {videoId:id, playlistSetVideoId:'entry-' + i, selected:i===current,
        title:{simpleText:'Queue ' + id}, thumbnail:{thumbnails:[{url:'https://i.ytimg.com/vi/'+id+'/default.jpg'}]},
        navigationEndpoint:{watchEndpoint:{videoId:id,playlistId:window.__state.queueId,index:placeholder ? i-1 : i}}};
      const row = document.createElement('ytd-playlist-panel-video-renderer');
      row.data = renderer;
      if(renderer.selected) row.setAttribute('selected','');
      if(i===unavailable) renderer.isPlayable=false;
      if(placeholder && i===0) {
        delete renderer.navigationEndpoint;
        delete renderer.selected;
      } else {
        const a = document.createElement('a');
        a.id='wc-endpoint';
        a.href='/watch?v='+id+'&list='+window.__state.queueId+'&index='+(placeholder ? i : i+1);
        a.onclick=e=>{e.preventDefault();window.__clicks.push(a.getAttribute('href'));};
        row.append(a);
      }
      items.append(row);
      return {playlistPanelVideoRenderer:renderer};
    });
    if(continuation) contents.push({continuationItemRenderer:{}});
    panel.data={playlistId:window.__state.queueId, currentIndex:window.__state.index,
      localCurrentIndex:current, totalVideos:ids.length,isInfinite:continuation,contents};
    window.__model=panel.data;
  };
  window.__render(['a','b','c'],1);
})()`;

type ActionSummary = { direction: string; preview: { title: string } | null; restarts: boolean };
const readExpression = `window.QueueTest.findPlaylistActions(document, document.querySelector('#movie_player video'))`;
const read = (page: Page): Promise<ActionSummary[]> => page.evaluate(`${readExpression}.map(a=>({direction:a.direction,preview:a.preview,restarts:a.restarts}))`);
const activate = (page: Page, direction: string): Promise<void> => page.evaluate(`${readExpression}.find(a=>a.direction===${JSON.stringify(direction)})?.activate()`);
const clicks = (page: Page): Promise<string[]> => page.evaluate('window.__clicks');

async function setup(page: Page): Promise<void> {
  await page.route('https://www.youtube.com/**', route => route.fulfill({status:200,contentType:'text/html',body:html}));
  await page.goto('https://www.youtube.com/watch?v=b&list=PLfixture');
  await page.addScriptTag({ content: `${bundle}\nwindow.QueueTest = QueueTest;` });
  await page.evaluate(fixture);
  await page.evaluate('window.QueueTest.installYouTubeQueueNavigation()');
}

for (const [name, browserType] of [['Chromium', chromium], ['Firefox', firefox]] as const) {
  describe(`YouTube queue navigation (${name})`, () => {
    it('uses collapsed queue links with missing native controls and keeps previews tied to targets', async t => {
      if (!existsSync(browserType.executablePath())) { t.skip('Browser not installed'); return; }
      const browser = await browserType.launch({headless:true});
      try {
        const page = await browser.newPage();
        await setup(page);
        // Queue takes precedence even when the native controls are available.
        assert.deepEqual((await read(page)).map(a=>a.preview?.title), ['Queue a','Queue c']);
        await page.evaluate('document.querySelectorAll("#movie_player button").forEach(b=>b.remove())');
        assert.deepEqual((await read(page)).map(a=>a.direction), ['previous','next']);
        await activate(page, 'previous');
        await activate(page, 'next');
        assert.deepEqual(await clicks(page), ['/watch?v=a&list=PLfixture&index=1','/watch?v=c&list=PLfixture&index=3']);
        await page.evaluate('window.__model.contents[2].playlistPanelVideoRenderer.thumbnail = {}');
        const next = (await read(page)).find(a=>a.direction==='next');
        assert.equal(next?.preview, null);
        assert.equal(next?.restarts, false);
        await activate(page, 'next');
        assert.equal((await clicks(page)).length, 3);
        await page.evaluate(`window.__stale=${readExpression}.find(a=>a.direction==='next');
          document.querySelector('ytd-playlist-panel-renderer').remove(); window.__stale.activate();`);
        assert.equal((await clicks(page)).length, 3);
        assert.deepEqual(await read(page), []);
      } finally { await browser.close(); }
    });

    it('handles the linkless current-video placeholder in a new session queue', async t => {
      if (!existsSync(browserType.executablePath())) { t.skip('Browser not installed'); return; }
      const browser = await browserType.launch({headless:true});
      try {
        const page = await browser.newPage();
        await setup(page);
        await page.evaluate(`history.replaceState(null,'','/watch?v=b');
          window.__state={video:'b',queueId:'TLsession',sequence:['c'],index:0};
          window.__render(['b','c'],1,{placeholder:true});
          document.querySelector('.ytp-next-button').style.display='none';`);
        const actions = await read(page);
        assert.deepEqual(actions.map(a=>a.direction), ['next']);
        assert.equal(actions[0].preview?.title, 'Queue c');
        await activate(page, 'next');
        assert.deepEqual(await clicks(page), ['/watch?v=c&list=TLsession&index=1']);
      } finally { await browser.close(); }
    });

    it('uses effective shuffled order, distinguishes duplicate occurrences, and rejects stale actions', async t => {
      if (!existsSync(browserType.executablePath())) { t.skip('Browser not installed'); return; }
      const browser = await browserType.launch({headless:true});
      try {
        const page = await browser.newPage();
        await setup(page);
        await page.evaluate(`window.__state.sequence=['c','b','a'];`);
        assert.deepEqual((await read(page)).map(a=>a.preview?.title), ['Queue c','Queue a']);
        await activate(page, 'next');
        assert.deepEqual(await clicks(page), ['/watch?v=a&list=PLfixture&index=1']);
        await page.evaluate(`window.__clicks=[]; window.__state.sequence=['a','b','b','c'];
          window.__state.index=2; window.__render(['a','b','b','c'],2);`);
        await activate(page, 'previous');
        assert.deepEqual(await clicks(page), ['/watch?v=b&list=PLfixture&index=2']);
        await page.evaluate(`window.__clicks=[];window.__stale=${readExpression}.find(a=>a.direction==='previous');
          document.querySelectorAll('ytd-playlist-panel-video-renderer a')[1].href='/watch?v=b&list=PLfixture&index=3';
          window.__stale.activate();`);
        assert.deepEqual(await clicks(page), []);
        assert.equal((await read(page)).find(a=>a.direction==='previous')?.preview?.title, 'Native previous');
        await page.evaluate(`window.__clicks=[]; window.__stale=${readExpression}.find(a=>a.direction==='next');
          window.__render(['c','b','b','a'],2); window.__state.sequence=['c','b','b','a']; window.__stale.activate();`);
        assert.deepEqual(await clicks(page), []);
        await page.evaluate(`window.__stale=${readExpression}.find(a=>a.direction==='next');
          history.replaceState(null,'','/watch?v=c&list=PLfixture'); window.__state.video='c'; window.__stale.activate();`);
        assert.deepEqual(await clicks(page), []);
      } finally { await browser.close(); }
    });

    it('falls back per direction for incomplete data and preserves native restart and wrapping', async t => {
      if (!existsSync(browserType.executablePath())) { t.skip('Browser not installed'); return; }
      const browser = await browserType.launch({headless:true});
      try {
        const page = await browser.newPage();
        await setup(page);
        await page.evaluate(`window.__render(['a','b','c'],1,{unavailable:2});`);
        assert.deepEqual((await read(page)).map(a=>a.preview?.title), ['Queue a','Native next']);
        await activate(page, 'next');
        assert.deepEqual(await clicks(page), ['Next']);
        await page.evaluate(`window.__clicks=[]; window.__render(['a','b'],1,{continuation:true});`);
        assert.equal((await read(page)).find(a=>a.direction==='next')?.preview?.title, 'Native next');
        await page.evaluate(`window.__render(['a','b'],1); window.__state.sequence=['a','b'];`);
        // An external recommendation must not replace a known finite queue's end.
        assert.deepEqual((await read(page)).map(a=>a.direction), ['previous']);
        await page.evaluate(`history.replaceState(null,'','/watch?v=a&list=PLfixture');
          window.__state.video='a';window.__state.sequence=['a','b','c'];window.__state.index=0;
          window.__render(['a','b','c'],0);
          document.querySelector('.ytp-prev-button').setAttribute('data-preview','https://i.ytimg.com/vi/c/default.jpg');`);
        assert.equal((await read(page))[0].preview?.title, 'Queue c');
        await page.evaluate(`document.querySelector('.ytp-prev-button').removeAttribute('data-preview');`);
        assert.equal((await read(page))[0].restarts, true);
        await page.evaluate(`document.documentElement.setAttribute('data-te-youtube-integration-off','');`);
        assert.equal((await read(page)).find(a=>a.direction==='next')?.preview?.title, 'Native next');
        await page.evaluate(`document.documentElement.removeAttribute('data-te-youtube-integration-off');
          document.querySelector('ytd-playlist-panel-renderer').data={};`);
        assert.equal((await read(page)).find(a=>a.direction==='next')?.preview?.title, 'Native next');
      } finally { await browser.close(); }
    });
  });
}

it('bridges private YouTube data into a genuine Chromium isolated world', async t => {
  if (!existsSync(chromium.executablePath())) { t.skip('Browser not installed'); return; }
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await setup(page);
    const client = await page.context().newCDPSession(page);
    const {frameTree} = await client.send('Page.getFrameTree');
    const {executionContextId} = await client.send('Page.createIsolatedWorld', {frameId:frameTree.frame.id,worldName:'queue-content'});
    const result = await client.send('Runtime.evaluate', {contextId:executionContextId,returnByValue:true,
      expression:`${bundle}; window.QueueTest=QueueTest;
        JSON.stringify({privateDataVisible:!!document.querySelector('ytd-playlist-panel-renderer').data,
          directions:${readExpression}.map(a=>a.direction),titles:${readExpression}.map(a=>a.preview?.title)})`});
    assert.equal(result.exceptionDetails, undefined);
    assert.deepEqual(JSON.parse(result.result.value), {privateDataVisible:false,directions:['previous','next'],titles:['Queue a','Queue c']});
    await client.send('Runtime.evaluate', {contextId:executionContextId,expression:`${readExpression}.find(a=>a.direction==='next').activate()`});
    assert.deepEqual(await clicks(page), ['/watch?v=c&list=PLfixture&index=3']);
  } finally { await browser.close(); }
});
