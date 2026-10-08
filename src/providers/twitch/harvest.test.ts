import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { twitchHarvestSnapshotMatchesPage } from './main';

describe('Twitch harvest snapshot binding', () => {
  it('rejects a child snapshot for a different VOD than the top page', () => {
    assert.equal(
      twitchHarvestSnapshotMatchesPage('https://www.twitch.tv/videos/123', '456'),
      false
    );
    assert.equal(
      twitchHarvestSnapshotMatchesPage('https://www.twitch.tv/videos/123', undefined),
      false
    );
  });

  it('accepts a snapshot for the same VOD or when the top page has no VOD id', () => {
    assert.equal(
      twitchHarvestSnapshotMatchesPage('https://www.twitch.tv/videos/123', '123'),
      true
    );
    assert.equal(
      twitchHarvestSnapshotMatchesPage('https://www.twitch.tv/directory', '123'),
      true
    );
  });
});

it('seeks Twitch VOD through its native control so replay follows the service clock', async () => {
  const { chromium } = await import('playwright');
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const esbuild = require('esbuild');
  const content = esbuild.buildSync({
    stdin: { contents: `import {seekToMediaTime} from './src/playback-window';
      import {handleTwitchMediaSeek} from './src/providers/twitch/main';
      window.seek = seekToMediaTime;
      window.addEventListener('theater-everywhere-media-seek', e => {
        const video = document.querySelector('video');
        if (!handleTwitchMediaSeek(e.detail, video) && Number.isFinite(e.detail.time)) video.currentTime = e.detail.time;
      });`, resolveDir: process.cwd() },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent'
  }).outputFiles[0].text;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://www.twitch.tv/**', route => route.fulfill({
      contentType: 'text/html', body: `<div class="video-player"><video></video>
        <div data-a-target="player-seekbar" style="width:1000px;height:20px"></div></div><div id="replay"></div>`
    }));
    await page.goto('https://www.twitch.tv/videos/123');
    await page.addScriptTag({ content });
    const report = await page.evaluate<{
      first: unknown; second: unknown; fallback: unknown;
      precise: { htmlClock: number; nativeClock: number; clicks: number };
    }>(`(() => {
      const v = document.querySelector('video'), bar = document.querySelector('[data-a-target="player-seekbar"]');
      let htmlClock = 0, nativeClock = 0, clicks = 0;
      Object.defineProperties(v, { duration: { get: () => 1200 }, currentTime: { get: () => htmlClock, set: t => htmlClock = t } });
      bar.addEventListener('click', event => {
        clicks++;
        const box = bar.getBoundingClientRect();
        nativeClock = (event.clientX - box.left) / box.width * v.duration;
        htmlClock = nativeClock;
        document.querySelector('#replay').textContent = String(nativeClock);
      });
      window.seek(v, 300);
      const first = { htmlClock, nativeClock, replay: document.querySelector('#replay').textContent, clicks };
      window.seek(v, 301.5);
      const precise = { htmlClock, nativeClock, clicks };
      window.seek(v, 900);
      const second = { htmlClock, nativeClock, replay: document.querySelector('#replay').textContent, clicks };
      bar.remove();
      window.seek(v, 600);
      const fallback = { htmlClock, nativeClock, clicks };
      return { first, precise, second, fallback };
    })()`);
    assert.deepEqual(report.first, { htmlClock: 300, nativeClock: 300, replay: '300', clicks: 1 });
    assert.ok(Math.abs(report.precise.htmlClock - 301.5) < 1e-6);
    assert.ok(Math.abs(report.precise.nativeClock - 301.5) < 1e-6);
    assert.equal(report.precise.clicks, 2);
    assert.deepEqual(report.second, { htmlClock: 900, nativeClock: 900, replay: '900', clicks: 3 });
    assert.deepEqual(report.fallback, { htmlClock: 600, nativeClock: 900, clicks: 3 });
    await page.goto('https://www.twitch.tv/channel');
    await page.addScriptTag({ content });
    const live = await page.evaluate(`(() => {
      const v = document.querySelector('video');let clock = 0;
      Object.defineProperties(v, {duration:{get:()=>1200},currentTime:{get:()=>clock,set:t=>clock=t}});
      let clicks = 0;document.querySelector('[data-a-target="player-seekbar"]').addEventListener('click',()=>clicks++);
      window.seek(v,300);return {clock,clicks};
    })()`);
    assert.deepEqual(live, { clock: 300, clicks: 0 });
  } finally { await browser.close(); }
});
