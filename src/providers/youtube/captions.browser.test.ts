import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { chromium, type Page } from 'playwright';

const require = createRequire(import.meta.url);
const esbuild = require(createRequire(require.resolve('vite')).resolve('esbuild')) as {
  buildSync(options: Record<string, unknown>): { outputFiles: Array<{ text: string }> };
};
const source = path.resolve(new URL('../..', import.meta.url).pathname);
const bundle = esbuild.buildSync({
  stdin: {
    contents: "export { installYoutubeMain, readYoutubeSnapshot, fetchTimedtextWithPot } from './providers/youtube/main'; export { requestYoutubePlayerCaptions } from './media-features/probe';",
    resolveDir: source, loader: 'ts'
  },
  bundle: true, write: false, format: 'iife', globalName: 'CaptionTest', platform: 'browser', target: 'es2022'
}).outputFiles[0].text;

async function setup(page: Page): Promise<void> {
  await page.route('https://www.youtube.com/**', route => route.fulfill({
    status: 200, contentType: 'text/html',
    body: '<!doctype html><div id="movie_player"><video></video><button class="ytp-subtitles-button" aria-pressed="false">CC</button></div>'
  }));
  await page.goto('https://www.youtube.com/watch?v=video-a');
  await page.addScriptTag({ content: `${bundle}\nwindow.CaptionTest = CaptionTest;` });
  await page.evaluate(`(() => {
    window.__calls = [];
    window.__tracks = [];
    window.__responseId = 'video-a';
    window.__installPlayer = player => {
      player.getPlayerResponse = () => ({videoDetails: {videoId: window.__responseId}});
      player.getOption = () => window.__tracks;
      player.loadModule = () => window.__calls.push({type:'load',player:player.id});
      player.unloadModule = () => {};
      player.setOption = (module, key, track) => window.__calls.push({type:'track',player:player.id,language:track.languageCode || null});
      const button = player.querySelector('button');
      button.onclick = () => {
        button.setAttribute('aria-pressed', button.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
        window.__calls.push({type:'click',player:player.id});
      };
    };
    window.__installPlayer(document.getElementById('movie_player'));
    window.__result = 'pending';
    window.__start = () => {
      window.__result = 'pending';
      window.CaptionTest.requestYoutubePlayerCaptions({enabled:true,language:'en'}).then(ok => window.__result = ok);
    };
    window.CaptionTest.installYoutubeMain();
  })()`);
}

const calls = (page: Page): Promise<Array<{ type: string; language?: string | null }>> => page.evaluate('window.__calls');
async function startPending(page: Page): Promise<void> {
  await page.evaluate('window.__start()');
  await page.waitForFunction('window.__calls.some(call => call.type === "load")');
  assert.equal(await page.evaluate('window.__result'), 'pending');
}
async function ready(page: Page): Promise<void> {
  await page.evaluate('window.__tracks = [{languageCode:"en"}]');
  await page.waitForFunction('window.__result !== "pending"');
}

// Runs the actual event bridge and host calls rather than a separate lifecycle model.
describe('YouTube captions request lifecycle', () => {
  it('acknowledges completion only after applying the requested track', async t => {
    if (!existsSync(chromium.executablePath())) { t.skip('Browser not installed'); return; }
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await setup(page);
      await startPending(page);
      await ready(page);
      assert.equal(await page.evaluate('window.__result'), true);
      assert.equal((await calls(page)).filter(call => call.type === 'track' && call.language === 'en').length, 1);
    } finally { await browser.close(); }
  });

  for (const [name, change] of [
    ['disable', 'window.CaptionTest.requestYoutubePlayerCaptions({enabled:false})'],
    ['navigation', 'history.replaceState(null,"","/watch?v=video-b"); window.dispatchEvent(new Event("yt-navigate-start"))'],
    ['player replacement', `const old = document.getElementById('movie_player'); const next = old.cloneNode(true); old.replaceWith(next); window.__installPlayer(next)`],
    ['media replacement', 'document.querySelector("video").replaceWith(document.createElement("video"))'],
    ['media source change', 'document.querySelector("video").setAttribute("src", "https://www.youtube.com/new-source")'],
    ['response identity change', 'window.__responseId = "video-b"']
  ] as const) {
    it(`rejects a pending request after ${name}`, async t => {
      if (!existsSync(chromium.executablePath())) { t.skip('Browser not installed'); return; }
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await setup(page);
        await startPending(page);
        await page.evaluate(change);
        await ready(page);
        assert.equal(await page.evaluate('window.__result'), false);
        assert.equal((await calls(page)).filter(call => call.language === 'en' || call.type === 'click').length, 0);
      } finally { await browser.close(); }
    });
  }

  it('rejects disable during the initial reset delay before loading the caption module', async t => {
    if (!existsSync(chromium.executablePath())) { t.skip('Browser not installed'); return; }
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await setup(page);
      await page.evaluate(`window.__start();
        window.CaptionTest.requestYoutubePlayerCaptions({enabled:false});
        window.__tracks = [{languageCode:'en'}]`);
      await page.waitForFunction('window.__result !== "pending"');
      assert.equal(await page.evaluate('window.__result'), false);
      assert.equal((await calls(page)).filter(call => call.type === 'load' || call.language === 'en' || call.type === 'click').length, 0);
    } finally { await browser.close(); }
  });

  for (const [name, action] of [
    ['disable', 'window.CaptionTest.requestYoutubePlayerCaptions({enabled:false})'],
    ['navigation', 'history.replaceState(null,"","/watch?v=video-b"); window.dispatchEvent(new Event("yt-navigate-start"))']
  ] as const) {
    it(`does not mint captions from an earlier fetch after ${name}`, async t => {
      if (!existsSync(chromium.executablePath())) { t.skip('Browser not installed'); return; }
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await setup(page);
        await page.evaluate(`window.__tracks = [{languageCode:'en'}];
          window.__mint = window.CaptionTest.fetchTimedtextWithPot('https://www.youtube.com/api/timedtext?v=video-a&lang=en');
          ${action}`);
        assert.equal(await page.evaluate('window.__mint'), null);
        assert.equal((await calls(page)).filter(call => call.type === 'load' || call.language === 'en' || call.type === 'click').length, 0);
      } finally { await browser.close(); }
    });
  }

  it('rejects superseded selections and applies the newest language once', async t => {
    if (!existsSync(chromium.executablePath())) { t.skip('Browser not installed'); return; }
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await setup(page);
      await startPending(page);
      await page.evaluate(`window.__second = window.CaptionTest.requestYoutubePlayerCaptions({enabled:true,language:'pl'});
        window.__tracks = [{languageCode:'en'}, {languageCode:'pl'}]`);
      await page.waitForFunction('window.__result !== "pending"');
      assert.equal(await page.evaluate('window.__result'), false);
      assert.equal(await page.evaluate('window.__second'), true);
      assert.deepEqual((await calls(page)).filter(call => call.language).map(call => call.language), ['pl']);
    } finally { await browser.close(); }
  });

  it('responds false to async rejection without an unhandled rejection', async t => {
    if (!existsSync(chromium.executablePath())) { t.skip('Browser not installed'); return; }
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await setup(page);
      await page.evaluate(`window.__unhandled = 0;
        window.addEventListener('unhandledrejection', () => window.__unhandled++);
        document.getElementById('movie_player').getOption = () => { throw new Error('Host tracks unavailable'); };
        window.__start()`);
      await page.waitForFunction('window.__result !== "pending"');
      assert.equal(await page.evaluate('window.__result'), false);
      assert.equal(await page.evaluate('window.__unhandled'), 0);
    } finally { await browser.close(); }
  });

  it('retains title and storyboard data when a host caption list is malformed', async t => {
    if (!existsSync(chromium.executablePath())) { t.skip('Browser not installed'); return; }
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await setup(page);
      await page.evaluate(`document.getElementById('movie_player').getPlayerResponse = () => ({
        videoDetails:{videoId:'video-a',title:'Title',lengthSeconds:'100'},
        captions:{playerCaptionsTracklistRenderer:{captionTracks:{unexpected:true}}},
        storyboards:{playerStoryboardSpecRenderer:{spec:'storyboard'}}
      })`);
      const result = await page.evaluate<Record<string, unknown>>('window.CaptionTest.readYoutubeSnapshot()');
      assert.equal(result.title, 'Title');
      assert.equal(result.storyboardSpec, 'storyboard');
      assert.deepEqual(result.captionTracks, []);
    } finally { await browser.close(); }
  });
});
