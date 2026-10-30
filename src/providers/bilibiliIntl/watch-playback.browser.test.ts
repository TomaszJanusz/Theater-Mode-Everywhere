import assert from 'node:assert/strict';
import { it } from 'node:test';

import { chromium, firefox } from 'playwright';

import { bundleModules } from '../../test-utils/player-boot';
import { sharedTestBrowser } from '../../test-utils/test-browser';
import { testEngines } from '../../test-utils/test-engines';

const bundle = bundleModules(["export { bilibiliIntlWatchPlayback as playback } from './providers/bilibiliIntl/watch-playback';"], 'IntlTest');

for (const engine of testEngines()) {
  const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
  it(`Bilibili.tv ${engine} rejects stale streams, ads and mini players and disposes observations`, { timeout: 60_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await page.route('https://www.bilibili.tv/**', route => route.fulfill({ contentType: 'text/html', body: `
      <div class="bstar-player"><div id="bilibiliPlayer" data-ui-mode="0">
      <div class="player-mobile-video-wrap"><video></video></div>
      <div class="player-mobile-ad-container" style="display:none"><video></video></div></div></div><video id="preview"></video>` }));
    await page.goto('https://www.bilibili.tv/en/video/123');
    await page.addScriptTag({ content: bundle });
    const results = await page.evaluate(`(async () => {
      const {playback} = IntlTest;
      const root = document.querySelector('#bilibiliPlayer');
      const video = root.querySelector('.player-mobile-video-wrap video');
      const ad = root.querySelector('.player-mobile-ad-container');
      const manifest = {originalUrl:location.href, type:'static'};
      window.dashPlayer = {video,state:{manifest}};
      const identity = playback.pageIdentity(new URL(location.href));
      const matches = () => playback.mainVideo(document, identity) === video;
      const out = [matches(),playback.preparingVideo(document, identity) === video];
      history.pushState({},'', '/en/video/456');
      out.push(playback.mainVideo(document,playback.pageIdentity(new URL(location.href))) === null);
      history.replaceState({},'', '/en/video/123');
      root.dataset.uiMode='4'; out.push(!matches()); root.dataset.uiMode='1'; out.push(matches());
      ad.style.display='block'; out.push(!matches()); ad.style.display='none';
      window.dashPlayer.video=document.querySelector('#preview'); out.push(!matches()); window.dashPlayer.video=video;
      manifest.type='dynamic'; out.push(!matches()); manifest.type='static';
      const extra = document.createElement('video'); video.parentElement.append(extra); out.push(!matches()); extra.remove();
      let changes=0; const stop=playback.observe(video,()=>changes++);
      ad.style.display='block'; await new Promise(queueMicrotask); out.push(changes===1);
      root.dataset.uiMode='4'; await new Promise(queueMicrotask); out.push(changes===2);
      stop();stop();ad.style.display='none';await new Promise(queueMicrotask);out.push(changes===2);
      delete window.dashPlayer;out.push(!matches());
      return out;
    })()`);
    assert.ok(Array.isArray(results) && results.every(value => value === true), JSON.stringify(results));
  });
}
