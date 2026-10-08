import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, firefox } from 'playwright';
import { debuggerPort, installFirefoxAddon } from './firefox-addon.mjs';

// Run from the repository root after pnpm build. Uses an isolated test profile.
const browserName = process.argv[2] ?? 'chromium';
const mode = process.argv[3] ?? 'live';
assert.ok(['live', 'replay', 'youtube-replay'].includes(mode));
if (mode === 'youtube-replay') assert.ok(process.argv[4], 'Pass the YouTube archive URL as the fourth argument');
assert.ok(['chromium', 'firefox'].includes(browserName));
const artifacts = path.resolve('docs/research/screenshots/current');
mkdirSync(artifacts, { recursive: true });
const extension = path.resolve(`dist/${browserName === 'firefox' ? 'firefox' : 'chrome'}-unpacked`);
const engine = browserName === 'firefox' ? firefox : chromium;
const profile = mkdtempSync(path.join(tmpdir(), `tme-chat-${browserName}-`));
const port = browserName === 'firefox' ? await debuggerPort() : null;
const context = await engine.launchPersistentContext(profile, {
  headless: false, viewport: { width: 1440, height: 900 }, locale: 'en-US',
  ...(browserName === 'firefox' ? {
    args: ['--start-debugger-server', String(port)],
    firefoxUserPrefs: { 'devtools.debugger.remote-enabled': true, 'devtools.debugger.prompt-connection': false,
      'devtools.chrome.enabled': true, 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0, 'media.videocontrols.picture-in-picture.video-toggle.enabled': false }
  } : { args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
    '--disable-blink-features=AutomationControlled', '--no-sandbox'] })
});
const page = context.pages()[0];
page.setDefaultTimeout(15000);
const results = {
  at: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  browser: browserName, installation: browserName === 'chromium' ? 'installed unpacked extension' : 'temporary addon',
  shortcut: 'Alt+R', firefoxAutoplayAllowed: browserName === 'firefox', bundles: Object.fromEntries(['content.js', 'content.css', 'mainWorld.js'].map(file =>
    [file, createHash('sha256').update(readFileSync(path.join(extension, file))).digest('hex')])), providers: {}
};
async function consent() {
  const button = page.locator('button').filter({ hasText: /^(Accept all|Reject all|Accept|I agree)$/i }).first();
  await button.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await button.isVisible().catch(() => false)) {
    await button.click({ timeout: 5000 }).catch(() => {});
    await button.waitFor({ state: 'hidden', timeout: 15000 });
  }
  if (new URL(page.url()).hostname.endsWith('twitch.tv')) {
    const gate = page.locator('[data-a-target="content-classification-gate-overlay-start-watching-button"]');
    await gate.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    if (await gate.isVisible().catch(() => false)) {
      await gate.click();
      await gate.waitFor({ state: 'hidden' });
    }
  }
}
async function state() {
  return page.evaluate(() => {
    const ui = document.getElementById('theater-everywhere-ui')?.shadowRoot;
    const root = document.querySelector('[data-theater-chat]');
    const box = root?.getBoundingClientRect();
    const video = document.querySelector('video');
    return {
      url: location.href, ua: navigator.userAgent, visibilityState: document.visibilityState,
      theater: document.documentElement.classList.contains('theater-everywhere-html-active'),
      visible: document.documentElement.hasAttribute('data-theater-chat-visible'),
      active: document.documentElement.hasAttribute('data-theater-chat-active'),
      nativeCollapsed: document.querySelector('ytd-live-chat-frame')?.hasAttribute('collapsed') ?? null,
      twitchToggle: document.querySelector('[data-a-target="right-column__toggle-collapse-btn"]')?.getAttribute('aria-label') ?? null,
      nativeClicks: window.__nativeClicks, frameLoads: window.__frameLoads,
      sameComponent: window.__component === document.querySelector('iframe#chatframe, [data-test-selector="chat-room-component-layout"], .right-column .video-chat'),
      videoWidth: document.documentElement.style.getPropertyValue('--theater-video-width'),
      videoHeight: document.documentElement.style.getPropertyValue('--theater-video-height'),
      video: video && { readyState: video.readyState, paused: video.paused, time: video.currentTime, error: video.error && { code: video.error.code, message: video.error.message } },
      chat: box && { x: box.x, y: box.y, width: box.width, height: box.height },
      fullscreen: document.fullscreenElement?.tagName ?? null,
      shortcut: ui?.querySelector('.theater-chat-toggle')?.getAttribute('aria-keyshortcuts'),
      headings: [...(ui?.querySelectorAll('.theater-settings-heading') ?? [])].map(n =>
        ({ text: n.textContent, transform: getComputedStyle(n).textTransform })),
      icons: ui?.querySelectorAll('[data-settings-section="chat"] .theater-settings-icon svg').length,
      theme: ui?.querySelector('.theater-chat-theme-select')?.value,
      fallback: !(ui?.querySelector('.theater-chat-theme-hint')?.hidden ?? true)
    };
  });
}
async function focusToggle() { await page.locator('.theater-chat-toggle').focus(); }
async function enterTheater() {
  await page.bringToFront();
  await page.waitForFunction(() => document.visibilityState === 'visible');
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.keyboard.press('t');
  await page.waitForSelector('.theater-chat-toggle:not([hidden])');
}
async function readyYouTubeChat() {
  await page.waitForFunction(() => {
    const doc = document.querySelector('#chatframe')?.contentDocument;
    return doc?.readyState === 'complete' && Boolean(doc.querySelector('yt-live-chat-renderer'));
  }, {}, { timeout: 30000 });
}
async function waitForPaintedChat() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const box = await page.locator('[data-theater-chat]').boundingBox();
    const screenshot = await page.screenshot();
    const painted = await page.evaluate(async ({ data, box }) => {
      const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      let nonBlack = 0;
      for (let y = box.y + 20; y < box.y + box.height - 20; y += 40) {
        for (let x = box.x + 20; x < box.x + box.width - 20; x += 40) {
          const pixel = ctx.getImageData(x, y, 1, 1).data;
          if (pixel[0] + pixel[1] + pixel[2] > 15) nonBlack++;
        }
      }
      return nonBlack;
    }, { data: screenshot.toString('base64'), box });
    if (painted > 10) return painted;
    await page.waitForTimeout(250);
  }
  throw new Error('Native chat exists but remains painted as a black panel');
}
async function captureSettings(provider) {
  // Two distinct moves ensure activity even when the previous pointer was at 100,100.
  await page.mouse.move(200, 120);
  await page.mouse.move(150, 120);
  await page.locator('.theater-controls-wrapper.visible').waitFor();
  await page.locator('.player-settings-btn').click();
  const select = page.locator('.theater-chat-theme-select');
  for (const theme of ['dark', 'light']) {
    await select.selectOption(theme);
    await page.waitForFunction(expected => document.documentElement.getAttribute('data-theater-chat-theme') === expected,
      theme, { timeout: 10000 });
    const paintedSamples = await waitForPaintedChat();
    const details = await state();
    assert.equal(details.fallback, false);
    assert.equal(details.shortcut, 'Alt+R');
    assert.equal(details.icons, 2);
    assert.deepEqual(details.headings.map(n => n.transform), ['uppercase', 'uppercase']);
    results.providers[provider].settings ??= [];
    const file = `${provider}-options-${theme}-${browserName}.png`;
    await page.screenshot({ path: path.join(artifacts, file) });
    results.providers[provider].settings.push({ file, paintedSamples, ...details });
  }
  await select.selectOption('native');
  await page.locator('.player-settings-btn').click();
}
async function fullscreenAndResponsive(provider) {
  await page.mouse.move(150, 100);
  await page.locator('.fullscreen-btn').click();
  await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
  await page.waitForFunction(() => {
    const box = document.querySelector('[data-theater-chat]')?.getBoundingClientRect();
    return box && Math.abs(box.right - innerWidth) < 1 && Math.abs(box.height - innerHeight) < 1
      && Math.abs(parseFloat(document.documentElement.style.getPropertyValue('--theater-video-width')) + box.width - innerWidth) < 1;
  });
  if (provider === 'youtube') {
    await readyYouTubeChat();
    await page.waitForFunction(() => document.querySelector('video')?.readyState === 4, {}, { timeout: 30000 });
  }
  await waitForPaintedChat();
  const fullscreen = await state();
  assert.equal(fullscreen.visible, true);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.setViewportSize({ width: 820, height: 900 });
  await page.waitForFunction(() => {
    const root = document.querySelector('[data-theater-chat]');
    const box = root?.getBoundingClientRect();
    return box?.width > 800 && box.y > 100 && document.documentElement.hasAttribute('data-theater-chat-visible');
  });
  await waitForPaintedChat();
  const responsive = await state();
  assert.equal(responsive.chat.width, 820);
  assert.equal(responsive.videoWidth, '820px');
  assert.ok(responsive.chat.y >= Number.parseFloat(responsive.videoHeight) - 1);
  await page.screenshot({ path: path.join(artifacts, `${provider}-bottom-${browserName}.png`) });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(() => document.querySelector('[data-theater-chat]')?.getBoundingClientRect().width < 700);
  results.providers[provider].fullscreen = fullscreen;
  results.providers[provider].responsive = responsive;
}
async function seekFromToolbar(time) {
  await page.bringToFront();
  await page.waitForFunction(() => document.visibilityState === 'visible');
  await page.waitForFunction(() => !document.querySelector('#movie_player')?.classList.contains('ad-showing'), {}, { timeout: 60000 });
  await page.mouse.move(100, 100);
  await page.waitForTimeout(250);
  const bar = page.locator('.theater-scrubber-container');
  const box = await bar.boundingBox();
  const duration = await page.evaluate(() => document.querySelector('video').duration);
  assert.ok(Number.isFinite(duration) && duration > time);
  await bar.click({ position: { x: box.width * time / duration, y: box.height / 2 } });
  await page.waitForFunction(({ target, tolerance }) => Math.abs(document.querySelector('video').currentTime - target) < tolerance
    && document.querySelector('video').readyState === 4, { target: time, tolerance: Math.max(10, 2 * duration / box.width) }, { timeout: 30000 });
}
async function qualifyReplay() {
  const targets = [['youtube', process.argv[4] ?? 'https://www.youtube.com/watch?v=wYSncx9zLIU']];
  if (mode === 'replay') targets.push(['twitch', 'https://www.twitch.tv/videos/2885653163']);
  for (const [provider, url] of targets) {
    results.providers[provider] = {};
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await consent();
      await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2, {}, { timeout: 30000 });
      if (provider === 'youtube') await consent();
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('t');
      await page.waitForSelector('.player-settings-btn');
      await page.bringToFront();
      await page.waitForFunction(() => document.visibilityState === 'visible');
      await page.waitForFunction(() => {
        const ui = document.getElementById('theater-everywhere-ui')?.shadowRoot;
        return !ui?.querySelector('.theater-chat-toggle')?.hidden
          || Boolean(document.querySelector('ytd-live-chat-frame[hide-chat-frame] ytd-message-renderer')?.textContent?.trim());
      });
      if (!await page.locator('.theater-chat-toggle').isVisible()) {
        results.providers[provider] = { status: 'service-disabled replay', ...await state() };
      } else {
        if (!(await state()).visible) await page.keyboard.press('Alt+R');
        await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-chat-visible'));
        if (provider === 'youtube') await readyYouTubeChat();
        await waitForPaintedChat();
        if (provider === 'youtube') {
          const frame = page.frameLocator('#chatframe');
          await frame.getByText('Top chat replay', { exact: true }).first().click();
          await frame.getByText('Live chat replay', { exact: true }).last().click();
          await frame.locator('yt-live-chat-header-renderer').filter({ hasText: 'Live chat replay' }).waitFor();
          results.providers[provider].filter = 'Top chat replay → Live chat replay';
        }
        await page.evaluate(() => { window.__component = document.querySelector('iframe#chatframe, [data-test-selector="chat-room-component-layout"], .right-column .video-chat'); });
        const snapshot = () => page.evaluate(() => {
          const frame = document.querySelector('#chatframe');
          const doc = frame?.contentDocument ?? document;
          return { time: document.querySelector('video')?.currentTime, paused: document.querySelector('video')?.paused,
            messages: doc.querySelectorAll('yt-live-chat-text-message-renderer, [data-a-target="chat-line-message"], .vod-message').length,
            fingerprint: [...doc.querySelectorAll('yt-live-chat-text-message-renderer, [data-a-target="chat-line-message"], .vod-message')].map(n => n.textContent).join('').split('').reduce((hash, char) => ((hash * 33) ^ char.charCodeAt(0)) >>> 0, 5381),
            frameUrl: frame?.contentWindow?.location.href, header: doc.querySelector('yt-live-chat-header-renderer')?.innerText ?? document.querySelector('.video-chat__header')?.innerText,
            timestamps: [...document.querySelectorAll('.vod-message__header')].map(n => n.textContent.trim()).slice(-3) };
        });
        const duration = await page.evaluate(() => document.querySelector('video').duration);
        const firstSeek = Math.min(300, Math.floor(duration * .25));
        const secondSeek = Math.min(900, Math.floor(duration * .75));
        if (await page.evaluate(() => document.querySelector('video').paused)) {
          await page.mouse.move(120, 100);
          await page.locator('.play-pause-btn').click();
          await page.waitForFunction(() => !document.querySelector('video').paused && document.querySelector('video').readyState === 4);
        }
        results.providers[provider].metadata = await page.evaluate(() => ({ title: document.title, publication: document.querySelector('#info-strings')?.textContent.trim() }));
        await seekFromToolbar(firstSeek);
        await page.waitForTimeout(4000);
        const before = await snapshot();
        await page.locator('.theater-chat-toggle').focus();
        await page.keyboard.press('Alt+R');
        await page.waitForFunction(() => !document.documentElement.hasAttribute('data-theater-chat-visible'));
        await page.keyboard.press('Alt+R');
        await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-chat-visible'));
        assert.equal((await state()).sameComponent, true);
        await seekFromToolbar(secondSeek);
        await page.waitForTimeout(4000);
        let after = await snapshot();
        for (let attempt = 0; after.fingerprint === before.fingerprint && attempt < 30; attempt++) {
          await page.waitForTimeout(1000);
          after = await snapshot();
        }
        if (!await page.evaluate(() => document.querySelector('video').paused)) {
          await page.mouse.move(120, 100);
          await page.locator('.play-pause-btn').click();
        }
        after = await snapshot();
        Object.assign(results.providers[provider], { firstSeek, secondSeek, before, after });
        assert.ok(before.messages > 0 && after.messages > 0, JSON.stringify({ before, after }));
        assert.notEqual(after.fingerprint, before.fingerprint, 'replay messages must update after seeking');
        if (provider === 'youtube') assert.ok(after.frameUrl.includes('live_chat_replay'));
        await page.screenshot({ path: path.join(artifacts, `${provider}-replay-${browserName}${provider === 'youtube' ? '-' + new URL(url).searchParams.get('v') : ''}.png`) });
        Object.assign(results.providers[provider], { status: 'replay preserved through hide/show and toolbar seeking', firstSeek, secondSeek, before, after, ...await state() });
      }
      await page.locator('.player-settings-btn').focus();
      await page.keyboard.press('Escape');
      results.providers[provider].restored = await state();
    } catch (error) { results.providers[provider].error = String(error.stack); process.exitCode = 1;
      results.providers[provider].failedState = await state().catch(() => null);
      results.providers[provider].ancestors = await page.evaluate(() => { const found = []; for (let n = document.querySelector('[data-theater-chat]'); n; n = n.parentElement) { const css = getComputedStyle(n); found.push({ tag: n.tagName, id: n.id, rect: n.getBoundingClientRect().toJSON(), css: Object.fromEntries(['position', 'left', 'right', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom', 'transform', 'translate', 'rotate', 'scale', 'filter', 'backdropFilter', 'perspective', 'contain', 'containerType', 'contentVisibility', 'willChange', 'viewTransitionName', 'zoom', 'zIndex'].map(k => [k, css[k]])) }); } return found; }).catch(() => null);
      await page.screenshot({ path: path.join(artifacts, `${provider}-replay-failure-${browserName}.png`) }).catch(() => {}); }
    console.log(JSON.stringify({ provider, result: results.providers[provider] }));
  }
}

try {
  if (browserName === 'firefox') {
    results.addonId = await installFirefoxAddon(port, extension);
  }
  if (mode !== 'live') { await qualifyReplay(); } else for (const [provider, url] of [['youtube', 'https://www.youtube.com/watch?v=1-LpQekNa9g'],
    ['twitch', 'https://www.twitch.tv/ewroon']]) {
    results.providers[provider] = {};
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await consent();
      if (provider === 'youtube') {
        await readyYouTubeChat();
        await consent();
        const frame = page.frames().find(f => /live_chat/.test(f.url()));
        await frame.locator('button[aria-label="Close"]').click();
        await page.waitForFunction(() => document.querySelector('ytd-live-chat-frame')?.hasAttribute('collapsed'));
      } else {
        await page.locator('[data-a-target="right-column__toggle-collapse-btn"][aria-label="Collapse Chat"]').click({ timeout: 25000 });
        await page.locator('[data-a-target="right-column__toggle-collapse-btn"][aria-label="Expand Chat"]').waitFor();
      }
      await page.evaluate(() => {
        window.__nativeClicks = 0; window.__frameLoads = 0;
        document.addEventListener('click', event => {
          if (event.target instanceof Element && event.target.closest('yt-video-metadata-carousel-view-model, #show-hide-button, [data-a-target="right-column__toggle-collapse-btn"]')) window.__nativeClicks++;
        }, true);
        window.__component = document.querySelector('iframe#chatframe, [data-test-selector="chat-room-component-layout"], .right-column .video-chat');
        window.__component?.addEventListener('load', () => window.__frameLoads++);
      });
      await enterTheater();
      const collapsed = await state();
      assert.equal(collapsed.visible, false);
      await page.keyboard.press('Alt+R');
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-chat-visible'));
      if (provider === 'youtube') await readyYouTubeChat();
      const paintedSamples = await waitForPaintedChat();
      const opened = await state();
      assert.equal(opened.nativeClicks, 1);
      assert.equal(provider === 'youtube' ? opened.nativeCollapsed : opened.twitchToggle === 'Expand Chat', false);
      const openingFile = `${provider}-opened-from-native-collapse-${browserName}.png`;
      await page.screenshot({ path: path.join(artifacts, openingFile) });
      await page.evaluate(() => { window.__component = document.querySelector('iframe#chatframe, [data-test-selector="chat-room-component-layout"], .right-column .video-chat'); });
      await focusToggle();
      await page.keyboard.press('Alt+R');
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-theater-chat-visible'));
      const hidden = await state();
      await page.keyboard.press('Alt+R');
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-chat-visible'));
      const reshown = await state();
      assert.equal(reshown.nativeClicks, 1);
      assert.equal(reshown.frameLoads, opened.frameLoads);
      assert.equal(reshown.sameComponent, true);
      Object.assign(results.providers[provider], { collapsed, opened, hidden, reshown, openingFile, paintedSamples });
      await captureSettings(provider);
      await fullscreenAndResponsive(provider);
      if (provider === 'youtube') {
        await readyYouTubeChat();
        const frame = page.frameLocator('#chatframe');
        await frame.getByText('Top chat', { exact: true }).first().click();
        await frame.getByText('Live chat', { exact: true }).last().click();
        await frame.locator('yt-live-chat-header-renderer').filter({ hasText: 'Live chat' }).waitFor();
        results.providers[provider].filter = 'Top chat → Live chat';
      }
      await focusToggle();
      await page.keyboard.press('Escape');
      results.providers[provider].restored = await state();
    } catch (error) {
      results.providers[provider].error = String(error.stack);
      results.providers[provider].failedState = await state().catch(() => null);
      results.providers[provider].ancestors = await page.evaluate(() => { const found = []; for (let n = document.querySelector('[data-theater-chat]'); n; n = n.parentElement) { const css = getComputedStyle(n); found.push({ tag: n.tagName, id: n.id, rect: n.getBoundingClientRect().toJSON(), css: Object.fromEntries(['position', 'left', 'right', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom', 'transform', 'translate', 'rotate', 'scale', 'filter', 'backdropFilter', 'perspective', 'contain', 'containerType', 'contentVisibility', 'willChange', 'viewTransitionName', 'zoom', 'zIndex'].map(k => [k, css[k]])) }); } return found; }).catch(() => null);
      results.providers[provider].failureDocument = await page.evaluate(() => ({ chatUrl: document.querySelector('#chatframe')?.contentWindow?.location.href, message: document.querySelector('#chatframe')?.contentDocument?.body?.innerText.slice(0, 200), playerError: document.querySelector('.ytp-error-content-wrap')?.innerText })).catch(() => null);
      await page.screenshot({ path: path.join(artifacts, `${provider}-failure-${browserName}.png`) }).catch(() => {});
      process.exitCode = 1;
      if (await page.evaluate(() => Boolean(document.fullscreenElement)).catch(() => false)) await page.evaluate(() => document.exitFullscreen());
    }
    console.log(JSON.stringify({ provider, result: results.providers[provider] }));
  }
} catch (error) {
  results.setupError = String(error.stack); process.exitCode = 1;
} finally {
  writeFileSync(path.join(artifacts, `native-chat-${mode === 'live' ? 'final' : mode}-${browserName}${mode === 'youtube-replay' ? '-' + new URL(process.argv[4]).searchParams.get('v') : ''}.json`), JSON.stringify(results, null, 2) + '\n');
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}
