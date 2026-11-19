import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { bootPlayer } from '../../test-utils/player-boot';
import { sharedTestBrowser } from '../../test-utils/test-browser';
import { testEngines } from '../../test-utils/test-engines';

const MEDIA = `data:video/webm;base64,${readFileSync(new URL('../../../test/fixtures/vod.webm', import.meta.url)).toString('base64')}`;

// A watch page whose player lays its controls out as YouTube's does (player 6b3d0364, checked live): the template
// caches the player size and republishes it only when a non-zero-area size changes; setSize() only re-measures; the
// controls lay out from the live size on each publish and on every fullscreen change, which the player handles
// before the watch page drops its fullscreen layout. Chapter widths and the settings menu's height come from that.
const WATCH = `<style>
  body { margin: 0; }
  #player-container { position: relative; width: 960px; padding-top: 540px; }
  ytd-watch-flexy[fullscreen] #player-container { width: 100vw; }
  #movie_player { position: absolute; inset: 0; overflow: hidden; background: #000; }
  video { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
  .ytp-chrome-bottom { position: absolute; bottom: 0; height: 48px; }
  .ytp-chapter-hover-container { float: left; height: 5px; margin-right: 2px; background: #f00; }
  .ytp-settings-menu { position: absolute; right: 12px; bottom: 62px; overflow: hidden; }
  .ytp-panel-menu { width: 250px; height: 256px; }
</style>
<ytd-app><ytd-watch-flexy video-id="aaaaaaaaaaa"><div id="player-container">
  <div id="movie_player" class="html5-video-player">
    <div class="html5-video-container"><video id="main" class="html5-main-video" muted loop></video></div>
    <div class="ytp-settings-menu" style="display: none;"><div class="ytp-panel"><div class="ytp-panel-menu"></div></div></div>
    <div class="ytp-chrome-bottom"><div class="ytp-progress-bar-container"><div class="ytp-chapters-container"></div></div>
      <div class="ytp-chrome-controls"><button class="ytp-settings-button">Settings</button></div></div>
  </div>
</div></ytd-watch-flexy></ytd-app>
<script>
  const player = document.getElementById('movie_player');
  const flexy = document.querySelector('ytd-watch-flexy');
  const chrome = player.querySelector('.ytp-chrome-bottom');
  const menu = player.querySelector('.ytp-settings-menu');
  const panel = menu.querySelector('.ytp-panel');
  const starts = [0, 0.08, 0.2, 0.31, 0.45, 0.52, 0.66, 0.79, 0.9, 1];
  const segments = starts.slice(1).map(() => player.querySelector('.ytp-chapters-container').appendChild(document.createElement('div')));
  segments.forEach(segment => segment.className = 'ytp-chapter-hover-container');
  const live = () => ({ width: player.clientWidth, height: player.clientHeight });
  let cached = live();
  let laidOutWidth = NaN;
  let menuMaxHeight = 0;
  const sizeMenu = () => {
    if (menu.style.display === 'none') return;
    const height = Math.max(1, Math.min(256, menuMaxHeight)) + 'px';
    Object.assign(menu.style, { width: '250px', height });
    Object.assign(panel.style, { width: '250px', height });
  };
  const layoutControls = () => {
    const { width, height } = live();
    if (width !== laidOutWidth) {
      laidOutWidth = width;
      const bar = width - 24;
      Object.assign(chrome.style, { width: bar + 'px', left: '12px' });
      const span = bar - 2 * segments.length;
      segments.forEach((segment, i) => { segment.style.width = Math.floor((starts[i + 1] - starts[i]) * span) + 'px'; });
    }
    menuMaxHeight = Math.min(413, Math.round((height - 60) * 0.82));
    sizeMenu();
  };
  const resize = () => {
    const size = live();
    if (size.width * size.height === 0 || (size.width === cached.width && size.height === cached.height)) return;
    cached = size;
    layoutControls();
  };
  window.addEventListener('resize', resize);
  document.addEventListener('fullscreenchange', () => {
    resize();
    layoutControls();
    flexy.toggleAttribute('fullscreen', Boolean(document.fullscreenElement));
  });
  player.querySelector('.ytp-settings-button').addEventListener('click', () => {
    menu.style.display = menu.style.display === 'none' ? '' : 'none';
    sizeMenu();
  });
  player.setSize = () => resize();
  player.getSize = live;
  player.getVideoData = () => ({ video_id: 'aaaaaaaaaaa' });
  player.getPlayerResponse = () => ({ videoDetails: { videoId: 'aaaaaaaaaaa', title: 'Chaptered video', lengthSeconds: '10' } });
  window.layoutRefreshes = 0;
  window.addEventListener('theater-everywhere-host-layout-refresh', () => { window.layoutRefreshes += 1; });
  layoutControls();
</script>`;

declare global { interface Window { layoutRefreshes: number } }

async function openWatch(page: Page): Promise<void> {
  await page.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: WATCH }));
  await page.goto('https://www.youtube.com/watch?v=aaaaaaaaaaa');
  await page.evaluate(media => {
    const video = document.querySelector<HTMLVideoElement>('#main')!;
    video.src = media;
    void video.play();
  }, MEDIA);
  await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('#main')!.readyState >= 2);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  await bootPlayer(page, { mainWorld: true });
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
}

// Each shortcut is debounced for 200 ms; run that on the fake clock.
async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await page.clock.runFor(300);
}

async function toggleFullscreen(page: Page, on: boolean): Promise<void> {
  await press(page, 'f');
  await page.waitForFunction(want => Boolean(document.fullscreenElement) === want && document.querySelector('ytd-watch-flexy')!.hasAttribute('fullscreen') === want, on);
}

const controls = (page: Page) => page.evaluate(() => {
  const player = document.getElementById('movie_player') as HTMLElement & { getSize(): { width: number; height: number } };
  const bar = player.querySelector('.ytp-progress-bar-container')!.getBoundingClientRect();
  const segments = [...player.querySelectorAll<HTMLElement>('.ytp-chapter-hover-container')];
  const menu = player.querySelector<HTMLElement>('.ytp-settings-menu')!;
  return {
    dom: [player.clientWidth, player.clientHeight],
    api: [player.getSize().width, player.getSize().height],
    rows: new Set(segments.map(segment => segment.offsetTop)).size,
    fits: segments.reduce((sum, segment) => sum + segment.offsetWidth + 2, 0) <= bar.width,
    menuHeight: menu.style.display === 'none' ? null : menu.getBoundingClientRect().height,
    style: player.getAttribute('style')
  };
});

for (const engine of testEngines()) {
  const shared = sharedTestBrowser(({ chromium, firefox })[engine]);

  it(`${engine}: YouTube's controls fit the player again after a fullscreen toggle during theater`, { timeout: 40_000 }, async t => {
    const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
    await openWatch(page);
    const before = await controls(page);
    assert.deepEqual(before, { dom: [960, 540], api: [960, 540], rows: 1, fits: true, menuHeight: null, style: null });

    await page.mouse.move(400, 300);
    await press(page, 't');
    await page.waitForFunction(() => document.documentElement.classList.contains('theater-everywhere-html-active'));
    // Theater leaves the host player without height, so YouTube keeps its cached size while the
    // fullscreen change lays the controls out for the viewport.
    await toggleFullscreen(page, true);
    await toggleFullscreen(page, false);
    assert.equal((await controls(page)).dom[1], 0);

    await press(page, 'Escape');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theater-everywhere-html-active')), false);
    // Both refreshes after exit, the second 120 ms after the first frame.
    await page.clock.runFor(500);
    assert.equal(await page.evaluate(() => window.layoutRefreshes), 2);
    await page.locator('.ytp-settings-button').click();

    assert.deepEqual(await controls(page), { ...before, menuHeight: 256 },
      'one row of chapters, the full settings menu, the API size the DOM size, and no inline style left behind');
  });
}
