import assert from 'node:assert/strict';
import { it } from 'node:test';
import { buildSync } from 'esbuild';
import { chromium, firefox } from 'playwright';
import { ownTestBrowser } from '../../test-utils/test-browser';

const bundle = buildSync({
  stdin: {
    contents: "export { bilibiliWatchPlayback as playback } from './watch-playback'; export { installBilibiliNavigation as install } from './navigation';",
    resolveDir: new URL('.', import.meta.url).pathname, loader: 'ts'
  }, bundle: true, write: false, format: 'iife', globalName: 'BilibiliTest'
}).outputFiles[0].text;

for (const engine of [chromium, firefox]) {
  it(`Bilibili ${engine.name()} confirms current content only and cleans up observations`, { timeout: 60_000 }, async t => {
    const browser = await engine.launch({ headless: true });
    ownTestBrowser(t, browser);
    const page = await browser.newPage();
    await page.route('https://www.bilibili.com/**', route => route.fulfill({ contentType: 'text/html', body: `
      <div class="bpx-player-container" data-screen="normal"><div class="bpx-player-primary-area">
      <div class="bpx-player-video-wrap"><video></video></div></div></div><video id="preview"></video>` }));
    await page.goto('https://www.bilibili.com/video/BV1xx411c7mu/');
    await page.addScriptTag({ content: bundle });
    const results = await page.evaluate(`(async () => {
      const {playback, install} = BilibiliTest;
      const root = document.querySelector('.bpx-player-container');
      const video = root.querySelector('video');
      let manifest = {bvid:'BV1xx411c7mu', p:1, cid:3635863, kind:0};
      window.player = {hasValidAdv:()=>false, mediaElement:()=>video, getManifest:()=>manifest, getElements:()=>({container:root})};
      const identity = playback.pageIdentity(new URL(location.href));
      const matches = () => playback.mainVideo(document,identity) === video;
      const output = [matches(), playback.preparingVideo(document,identity) === video];
      window.player.hasValidAdv = () => true; output.push(!matches());
      window.player.hasValidAdv = () => false;
      manifest = {...manifest,bvid:'BV1fs411o76f'}; output.push(!matches());
      manifest = {...manifest,bvid:'BV1xx411c7mu',p:2}; output.push(!matches());
      manifest = {...manifest,p:1,kind:1}; output.push(!matches());
      manifest = {...manifest,kind:0};
      window.player.mediaElement = () => document.querySelector('#preview'); output.push(!matches());
      window.player.mediaElement = () => video;
      root.dataset.screen = 'mini'; output.push(!matches()); root.dataset.screen = 'normal';
      const extra = document.createElement('video'); video.parentElement.append(extra); output.push(!matches()); extra.remove();
      let changes = 0; const stop = playback.observe(video,()=>changes++);
      root.dataset.screen = 'mini'; await new Promise(queueMicrotask); output.push(changes === 1);
      stop(); stop(); root.dataset.screen = 'normal'; await new Promise(queueMicrotask); output.push(changes === 1);
      let navigations=0; window.addEventListener(playback.refreshEvents[0],()=>navigations++);
      install(); install(); history.pushState({},'', '/video/BV1xx411c7mu/?p=2');
      output.push(navigations===1, playback.pageIdentity(new URL(location.href)) !== identity, playback.mainVideo(document, playback.pageIdentity(new URL(location.href))) === null);
      history.replaceState({},'', '/'); output.push(navigations===2, playback.pageIdentity(new URL(location.href))===null);
      window.player.getManifest = () => {throw new Error('retired player')}; output.push(!matches());
      return output;
    })()`);
    assert.ok(Array.isArray(results) && results.every(value => value === true), JSON.stringify(results));
    await browser.close();
  });
}
