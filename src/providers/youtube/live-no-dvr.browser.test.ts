import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { bootPlayer, bundlePlayer, enterTheater } from '../../test-utils/player-boot';
import { sharedTestBrowser } from '../../test-utils/test-browser';
import { selectTestEngines } from '../../test-utils/test-engines';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const MEDIA = readFileSync(path.join(ROOT, 'test/fixtures/vod.webm'));
const browsers = { Chromium: sharedTestBrowser(chromium), Firefox: sharedTestBrowser(firefox) };

// The native chrome of a YouTube live stream without DVR, as recorded on 2026-11-03 (NBC News NOW,
// B9i_01yEgt0): YouTube keeps a full-width progress bar at the live head but disables its container,
// while the media element reports the whole stream as seekable and getProgressState() has allowSeeking false.
const PAGE = `<!doctype html><meta charset="utf-8"><title>Live without DVR</title>
<style>body{margin:0;background:#111}#movie_player{width:960px;height:540px;position:relative}video{width:960px;height:540px}</style>
<div id="movie_player" class="html5-video-player ytp-livebadge-color"><div class="html5-video-container"><video muted loop src="/vod.webm"></video></div>
<div class="ytp-chrome-bottom"><div class="ytp-progress-bar-container" aria-disabled="true"><div class="ytp-progress-bar" tabindex="0" role="slider"
aria-label="Seek slider" aria-valuemin="0" aria-valuemax="2157" aria-valuenow="2157"></div></div>
<button class="ytp-live-badge ytp-button ytp-live-badge-is-livehead" disabled>Live</button></div></div>
<script>
  const player = document.getElementById('movie_player');
  const video = player.querySelector('video');
  window.hostSeeks = [];
  window.hostCommands = [];
  Object.assign(player, {
    getProgressState: () => ({ allowSeeking: !document.querySelector('.ytp-progress-bar-container').hasAttribute('aria-disabled'), isAtLiveHead: true }),
    seekTo: time => window.hostSeeks.push(time),
    seekToLiveHead: () => {},
    pauseVideo: () => { window.hostCommands.push('pauseVideo'); video.pause(); },
    // After stopVideo() YouTube loads the stream again; here, the same clip.
    playVideo: () => {
      window.hostCommands.push('playVideo');
      if (!video.getAttribute('src')) video.src = '/vod.webm';
      video.play();
    }
  });
</script>`;

async function boot(page: Page): Promise<void> {
  await page.route('https://www.youtube.com/**', route => route.fulfill(route.request().url().endsWith('/vod.webm')
    ? { body: MEDIA, contentType: 'video/webm' }
    : { contentType: 'text/html', body: PAGE }));
  await page.goto('https://www.youtube.com/watch?v=live');
  await page.waitForFunction(() => document.querySelector('video')!.readyState >= 2);
  await bootPlayer(page, { settings: { keepControlsVisible: true, shortcuts: { playPause: 'k' } }, mainWorld: true, bundle: bundlePlayer() });
  await page.evaluate(() => {
    const w = window as unknown as { seekRequests: string[] };
    w.seekRequests = [];
    window.addEventListener('theater-everywhere-media-seek', event => w.seekRequests.push((event as CustomEvent<string>).detail));
  });
  await enterTheater(page);
}

const state = (page: Page) => page.evaluate(() => {
  const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
  const scrubber = root.querySelector<HTMLElement>('.theater-scrubber-container')!;
  const video = document.querySelector('video')!;
  const w = window as unknown as { seekRequests: string[]; hostSeeks: number[]; hostCommands: string[] };
  return {
    scrubberDisabled: scrubber.getAttribute('aria-disabled'),
    scrubberTab: scrubber.tabIndex,
    live: root.querySelector('.theater-time-elapsed')!.classList.contains('theater-time-live'),
    loading: root.querySelector('.theater-loading-indicator')!.classList.contains('visible'),
    playLabel: root.querySelector('.play-pause-btn')!.getAttribute('aria-label'),
    paused: video.paused,
    currentTime: video.currentTime,
    seekRequests: w.seekRequests.filter(detail => 'time' in JSON.parse(detail)).length,
    hostSeeks: w.hostSeeks.length,
    hostCommands: w.hostCommands.splice(0)
  };
});

for (const name of selectTestEngines(['Chromium', 'Firefox'] as const, name => name)) {
  it(`${name}: a YouTube live without DVR locks the timeline, stops like YouTube and never asks the host to seek`, { timeout: 60_000 }, async t => {
    const page = await (await browsers[name].newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await boot(page);
    await page.evaluate(() => document.querySelector('video')!.pause());

    const locked = await state(page);
    assert.equal(locked.live, true, 'the clock shows LIVE');
    assert.equal(locked.scrubberDisabled, 'true', 'the scrubber is disabled');
    assert.equal(locked.scrubberTab, -1);

    const box = (await page.locator('.theater-scrubber-container').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2);
    for (const key of ['ArrowLeft', 'j', 'l', 'ArrowRight', ',', '.']) await page.keyboard.press(key);
    // A request that was already in flight when the host disabled seeking is consumed in MAIN, not applied to the media.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('theater-everywhere-media-seek', { detail: JSON.stringify({ time: 0.5 }) })));
    const afterSeeks = await state(page);
    assert.equal(afterSeeks.seekRequests, 1, 'the scrubber and seek shortcuts issue no seek request');
    assert.equal(afterSeeks.hostSeeks, 0, 'the host player is never asked to seek');
    assert.equal(afterSeeks.currentTime, locked.currentTime, 'the media element is not seeked');
    assert.equal(afterSeeks.loading, false, 'no seek spinner waits for a seek that cannot happen');

    const playing = () => page.waitForFunction(() => !document.querySelector('video')!.paused);
    const paused = () => page.waitForFunction(() => document.querySelector('video')!.paused);
    await page.keyboard.press('k');
    await playing();
    let now = await state(page);
    assert.deepEqual(now.hostCommands, ['playVideo'], 'play goes through YouTube, which rejoins the live edge');
    assert.equal(now.playLabel, 'Stop', 'the button stops, as YouTube\'s does on this stream');
    await page.keyboard.press('k');
    await paused();
    now = await state(page);
    assert.deepEqual(now.hostCommands, ['pauseVideo'], 'stop is YouTube\'s pause, not stopVideo()');
    assert.equal(now.playLabel, 'Play');
    assert.equal(await page.locator('.playback-hud rect[width="34"]').count(), 1, 'the indicator shows a stop, not a pause');
    await page.locator('.play-pause-btn').click();
    await playing();
    assert.deepEqual((await state(page)).hostCommands, ['playVideo'], 'the bar button follows the same path');
    assert.equal(await page.locator('.play-pause-btn').evaluate(e => e.querySelector('rect[width="14"]') !== null), true, 'a stop square');

    // A host that reloads its media while playing pauses the element without a pause event.
    await page.evaluate(() => new Promise<void>(resolve => {
      const video = document.querySelector('video')!;
      video.addEventListener('emptied', () => resolve(), { once: true });
      video.load();
    }));
    const reset = await state(page);
    assert.equal(reset.paused, true);
    assert.equal(reset.playLabel, 'Play', 'the button follows a media reset');

    // stopVideo() unloads the media: only YouTube can start it again, never play() on the empty element.
    await page.evaluate(() => new Promise<void>(resolve => {
      const video = document.querySelector('video')!;
      video.addEventListener('emptied', () => resolve(), { once: true });
      video.removeAttribute('src');
      video.load();
    }));
    await page.keyboard.press('Space');
    await playing();
    now = await state(page);
    assert.deepEqual(now.hostCommands, ['playVideo']);
    assert.equal(now.loading, false, 'no spinner is left waiting on the empty element');

    // The same stream with DVR: YouTube enables the bar, so the timeline is seekable again.
    await page.evaluate(() => {
      document.querySelector('.ytp-progress-bar-container')!.removeAttribute('aria-disabled');
      document.querySelector('video')!.dispatchEvent(new Event('timeupdate'));
    });
    now = await state(page);
    assert.equal(now.scrubberDisabled, 'false', 'a live stream with DVR stays seekable');
    assert.equal(now.playLabel, 'Pause', 'and pauses');
    await page.keyboard.press('k');
    await paused();
    assert.deepEqual((await state(page)).hostCommands, [], 'its pause stays with the element');
    assert.deepEqual(errors, []);
  });
}
