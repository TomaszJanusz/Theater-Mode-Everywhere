import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

import { sharedTestBrowser } from '../../src/test-utils/test-browser';

import { PROBE_SCRIPT, installConsentHandler, launchBrowser, openSettings, navigateSpa, readPlayer, seekFragment, toggleTheater, type Session } from './browser';
import { measure } from './measurement';
import { ensureDisplay, Resources } from './processes';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const media = readFileSync(path.join(ROOT, 'test/fixtures/vod.webm'));
const available = existsSync(chromium.executablePath());
const shared = sharedTestBrowser(chromium);

it('browser fixture binds graphs to media, reads focus and observes same-document transitions', { skip: !available, timeout: 30000 }, async t => {
  const context = await shared.newContext(t, { viewport: { width: 1440, height: 900 } });
  const browser = context.browser()!;
  await context.addInitScript({ content: PROBE_SCRIPT });
  await context.route('https://www.youtube.com/**', route => {
    if (route.request().url().includes('vod.webm')) return route.fulfill({ contentType: 'video/webm', body: media });
    return route.fulfill({ contentType: 'text/html', body: `<ytd-app></ytd-app><ytd-watch-flexy></ytd-watch-flexy><div id="movie_player"><video class="html5-main-video" src="/vod.webm"></video></div><button id="activate">Audio</button><div id="theater-everywhere-ui"></div>` });
  });
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=IGk17XQ7IrQ');
  await page.waitForFunction(() => document.querySelector('video')!.readyState >= 1);
  await page.evaluate(() => {
    const movie = document.getElementById('movie_player')!;
    const video = document.querySelector('video')!;
    Object.assign(movie, { getVideoData: () => ({ video_id: new URL(location.href).searchParams.get('v') }),
      getVideoStats: () => ({ fmt: '134', afmt: '140', fps: 30 }), getPlaybackQuality: () => 'medium',
      getVolume: () => 100, getDrcUserPreference: () => false, getVoiceBoostUserPreference: () => false, seekTo: (time: number) => { movie.dataset.seekTime = String(time); video.currentTime = time; }, playVideo: () => { void video.play(); } });
    Object.assign(document.querySelector('ytd-watch-flexy')!, { cinematicsActive: false });
    const root = document.getElementById('theater-everywhere-ui')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<div class="theater-controls-wrapper visible"><input class="theater-volume-slider"></div>';
    document.getElementById('activate')!.onclick = () => {
      const ctx = new AudioContext(), gain = ctx.createGain(); gain.gain.value = 3;
      ctx.createMediaElementSource(video).connect(gain).connect(ctx.destination);
      Object.assign(video.dataset, { theaterBoostReady: 'true', theaterBoost: '3', theaterVoice: 'off', theaterLeveling: 'off', theaterBass: 'original' });
      void ctx.resume();
    };
    window.addEventListener('keydown', event => { if (event.key === 't') document.documentElement.classList.toggle('theater-everywhere-html-active'); });
    document.querySelector('ytd-app')!.addEventListener('yt-navigate', event => {
      const id: unknown = (event as CustomEvent<{ endpoint: { watchEndpoint: { videoId: unknown } } }>).detail.endpoint.watchEndpoint.videoId;
      if (typeof id === 'string') history.pushState({}, '', `/watch?v=${id}`);
    });
  });
  await installConsentHandler(page);
  await page.evaluate(() => {
    const dialog = document.createElement('ytd-consent-bump-v2-lightbox');
    dialog.innerHTML = '<button aria-label="Reject the use of cookies and personal data">Reject all</button>';
    dialog.querySelector('button')!.onclick = () => dialog.remove();
    document.body.append(dialog);
  });
  const before = await readPlayer(page); assert.equal(before.video!.graph, null);
  await page.click('#activate');
  assert.equal(await page.locator('ytd-consent-bump-v2-lightbox').count(), 0);
  await page.waitForFunction(() => window.__cpuSuiteProbe!.graphs.get(document.querySelector('video')!)?.context.state === 'running');
  await page.locator('.theater-volume-slider').focus();
  const focused = await readPlayer(page);
  assert.equal(focused.sliderFocused, true); assert.equal(focused.video!.graph!.gain, 3);
  const token = focused.videoToken;
  await page.evaluate(() => {
    const button = document.createElement('button'); button.className = 'ytp-settings-button'; button.setAttribute('aria-expanded', 'true'); button.textContent = 'Settings';
    const menu = document.createElement('div'); menu.className = 'ytp-settings-menu'; menu.textContent = 'Opening settings'; menu.style.visibility = 'hidden';
    button.onclick = () => { button.setAttribute('aria-expanded', 'false'); menu.style.visibility = 'hidden'; };
    document.getElementById('movie_player')!.append(button, menu);
    requestAnimationFrame(() => { menu.style.visibility = 'visible'; });
  });
  await openSettings(page);
  assert.equal(await page.locator('.ytp-settings-button').getAttribute('aria-expanded'), 'true', 'an opening menu must not be toggled closed');
  const browserCdp = await browser.newBrowserCDPSession(), pageCdp = await context.newCDPSession(page);
  const cpu = await measure({ context, page, browserCdp, pageCdp, worker: null, close: () => context.close() }, 100);
  assert.equal(cpu.counterError, null);
  assert.equal(typeof cpu.rendererPct, 'number');
  assert.equal(typeof cpu.threadPct, 'number');
  await pageCdp.detach(); await browserCdp.detach();
  const fragment = { url: page.url(), id: 'IGk17XQ7IrQ', quality: 'medium', width: 640, height: 360, fps: null, startSec: 0 };
  await seekFragment(page, fragment, true);
  assert.equal(await page.locator('#movie_player').getAttribute('data-seek-time'), '0');
  assert.ok((await readPlayer(page)).video!.currentTime <= 0.4);
  await page.evaluate(() => Reflect.deleteProperty(document.getElementById('movie_player')!, 'seekTo'));
  await assert.rejects(seekFragment(page, fragment, true), /native-api-unavailable/);
  await toggleTheater(page, true); assert.equal((await readPlayer(page)).theater, true);
  await toggleTheater(page, false); assert.equal((await readPlayer(page)).theater, false);
  const dimensions = await page.evaluate(() => { const v = document.querySelector('video')!; return [v.videoWidth, v.videoHeight]; });
  await navigateSpa(page, { url: 'https://www.youtube.com/watch?v=abcdefghijk', id: 'abcdefghijk', quality: 'medium',
    width: dimensions[0], height: dimensions[1], fps: null, startSec: 0 });
  assert.equal((await readPlayer(page)).videoId, 'abcdefghijk');
  assert.equal((await readPlayer(page)).videoToken, token, 'a reused media element may retain its graph across SPA navigation');
  await page.evaluate(() => document.querySelector('video')!.replaceWith(document.querySelector('video')!.cloneNode(true)));
  const replaced = await readPlayer(page);
  assert.notEqual(replaced.videoToken, token); assert.equal(replaced.video!.graph, null);
});
it('headed setup failure closes its context and owned Xvfb; repeated cleanup is safe', {
  skip: !available || process.platform !== 'linux', timeout: 30000
}, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cpu-suite-browser-'));
  const resources = new Resources(); let captured: Session | null = null;
  const originalDisplay = process.env.DISPLAY;
  try {
    const display = await ensureDisplay(resources);
    await assert.rejects(launchBrowser(path.join(dir, 'profile'), chromium.executablePath(), null, resources,
      path.join(dir, 'diagnostic'), async session => { captured = session; throw new Error('Injected setup failure'); }), /Injected setup failure/);
    assert.ok(captured);
    const session = captured as Session;
    assert.equal(session.page.isClosed(), true);
    assert.ok(existsSync(path.join(dir, 'diagnostic.log')));
    await resources.close(); await resources.close();
    assert.equal(process.env.DISPLAY, originalDisplay);
    if (!originalDisplay) assert.equal(existsSync(`/tmp/.X11-unix/X${display.display.slice(1)}`), false);
  } finally { await resources.close(); rmSync(dir, { recursive: true, force: true }); }
});
