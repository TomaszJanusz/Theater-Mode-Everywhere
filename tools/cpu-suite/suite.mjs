#!/usr/bin/env node
// Headed YouTube CPU suite: theater states plus YouTube's cinematic lighting,
// voice boost and stable volume. Output, profiles and any Xvfb this starts
// stay in the system temp directory, outside the product tree.
//
//   node tools/cpu-suite/suite.mjs run
//   node tools/cpu-suite/suite.mjs run --states reference,native-voice
//   node tools/cpu-suite/suite.mjs probe
//   node tools/cpu-suite/suite.mjs topup
//   node tools/cpu-suite/suite.mjs report
//
// Build dist/chrome-unpacked first. Set DISPLAY to reuse an existing X server;
// otherwise the suite starts Xvfb on a free display. CHROME_PATH overrides
// Playwright's Chromium. CPU_SUITE_CONFIG overrides the default config.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG_PATH = process.env.CPU_SUITE_CONFIG
  ? path.resolve(process.env.CPU_SUITE_CONFIG)
  : path.join(REPO, 'tools/cpu-suite/suite.config.json');
const workDir = path.join(os.tmpdir(), 'te-cpu-suite');

function gitSha() {
  try {
    return execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function resolveFromRepo(value) {
  return path.isAbsolute(value) ? value : path.resolve(REPO, value);
}

const rawConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const headSha = gitSha();
if (rawConfig.extension.sha && headSha && rawConfig.extension.sha !== headSha) {
  throw new Error(`config pins ${rawConfig.extension.sha}, HEAD is ${headSha}`);
}
const config = {
  ...rawConfig,
  extension: {
    ...rawConfig.extension,
    path: resolveFromRepo(rawConfig.extension.path),
    sha: rawConfig.extension.sha || headSha
  },
  outDir: rawConfig.outDir ? resolveFromRepo(rawConfig.outDir) : path.join(workDir, 'results', rawConfig.videoId)
};
const CHROME = process.env.CHROME_PATH || chromium.executablePath();
const CLK_TCK = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim() || 100);
const log = (...args) => console.log(new Date().toISOString(), ...args);

const EXTENSION_STATES = new Set(['neutral', 'boost-focused', 'boost-hidden', 'active', 'paused', 'disabled']);
const NATIVE_WANT = {
  reference: { stable: false, voice: false, cinematic: false },
  'native-cinematic': { stable: false, voice: false, cinematic: true },
  'native-voice': { stable: false, voice: true, cinematic: false },
  'native-stable': { stable: true, voice: false, cinematic: false },
  'native-all': { stable: true, voice: true, cinematic: true, allowStableForcedOff: true },
  neutral: { stable: false, voice: false, cinematic: false },
  'boost-focused': { stable: false, voice: false, cinematic: false },
  'boost-hidden': { stable: false, voice: false, cinematic: false },
  active: { stable: false, voice: false, cinematic: false },
  paused: { stable: false, voice: false, cinematic: false },
  disabled: { stable: false, voice: false, cinematic: false }
};

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function readProcStat() {
  const parts = readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
  return { idle: parts[3] + (parts[4] || 0), total: parts.reduce((sum, value) => sum + value, 0) };
}
function machineBusyPercent(before, after, wallSec) {
  const total = after.total - before.total;
  const idle = after.idle - before.idle;
  if (wallSec <= 0 || total <= 0) return null;
  return 100 * ((total - idle) / CLK_TCK) / wallSec;
}
function procTicks(pid) {
  try {
    const text = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = text.slice(text.lastIndexOf(')') + 2).split(' ');
    return Number(rest[11]) + Number(rest[12]);
  } catch { return null; }
}
function chromeCpuSnapshot() {
  const rows = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    let cmd = '';
    try { cmd = readFileSync(`/proc/${entry}/cmdline`); } catch { continue; }
    if (!cmd.includes(CHROME)) continue;
    const ticks = procTicks(entry);
    if (ticks == null) continue;
    rows.push({ pid: Number(entry), ticks });
  }
  return rows;
}
function loadavg() { return readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/).slice(0, 3).map(Number); }
function meminfo() {
  const text = readFileSync('/proc/meminfo', 'utf8');
  const pick = (name) => Number(text.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'))?.[1] || 0);
  return { memTotalKiB: pick('MemTotal'), memAvailableKiB: pick('MemAvailable'), swapTotalKiB: pick('SwapTotal'), swapFreeKiB: pick('SwapFree') };
}
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}
function buildFor(state) {
  if (!EXTENSION_STATES.has(state)) return null;
  const ext = config.extension;
  return {
    name: ext.name,
    sha: ext.sha,
    ext: ext.path,
    mainWorldSha256: createHash('sha256').update(readFileSync(`${ext.path}/mainWorld.js`)).digest('hex'),
    manifestVersion: JSON.parse(readFileSync(`${ext.path}/manifest.json`, 'utf8')).version
  };
}

function freeDisplay() {
  for (let number = 140; number < 220; number++) {
    if (!existsSync(`/tmp/.X11-unix/X${number}`)) return `:${number}`;
  }
  throw new Error('no free X display');
}

async function ensureDisplay() {
  if (process.env.DISPLAY) return process.env.DISPLAY;
  const logs = path.join(workDir, 'logs');
  mkdirSync(logs, { recursive: true });
  const pidFile = path.join(logs, 'xvfb.pid');
  if (existsSync(pidFile)) {
    const [pidText, display] = readFileSync(pidFile, 'utf8').trim().split(/\s+/);
    const pid = Number(pidText);
    let alive = false;
    if (pid) { try { process.kill(pid, 0); alive = true; } catch { alive = false; } }
    if (alive && display) {
      process.env.DISPLAY = display;
      return display;
    }
  }
  const display = freeDisplay();
  const child = spawn('Xvfb', [display, '-screen', '0', '1920x1080x24', '-ac', '+extension', 'GLX', '+render', '-noreset'], {
    detached: true, stdio: 'ignore'
  });
  child.unref();
  writeFileSync(pidFile, `${child.pid} ${display}\n`);
  process.env.DISPLAY = display;
  const socket = `/tmp/.X11-unix/X${display.slice(1)}`;
  for (let attempt = 0; attempt < 25 && !existsSync(socket); attempt++) await sleep(100);
  log('started Xvfb', child.pid, display);
  return display;
}

async function launchBrowser(state) {
  const build = buildFor(state);
  const profile = path.join(workDir, 'profiles', `suite-${build ? build.name : 'plain'}`);
  mkdirSync(profile, { recursive: true });
  rmSync(`${profile}/SingletonLock`, { force: true });
  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio', '--window-size=1600,1000', '--window-position=0,0'];
  if (build) args.push(`--disable-extensions-except=${build.ext}`, `--load-extension=${build.ext}`);
  const context = await chromium.launchPersistentContext(profile, {
    headless: false, executablePath: CHROME, viewport: null, args
  });
  const page = context.pages()[0] || await context.newPage();
  for (const extra of context.pages().slice(1)) await extra.close();
  const browserCdp = await context.browser().newBrowserCDPSession();
  const pageCdp = await context.newCDPSession(page);
  const target = await pageCdp.send('Target.getTargetInfo');
  const { windowId } = await browserCdp.send('Browser.getWindowForTarget', { targetId: target.targetInfo.targetId });
  await browserCdp.send('Browser.setWindowBounds', {
    windowId, bounds: { windowState: 'normal', left: 0, top: 0, width: 1600, height: 1000 }
  });
  let worker = null;
  if (build) worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  return { context, page, browserCdp, pageCdp, windowId, worker, build };
}

async function fitViewport(session) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const size = await session.page.evaluate(() => ({ inner: [innerWidth, innerHeight] }));
    const dx = 1440 - size.inner[0];
    const dy = 900 - size.inner[1];
    if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) return;
    const bounds = await session.browserCdp.send('Browser.getWindowBounds', { windowId: session.windowId });
    await session.browserCdp.send('Browser.setWindowBounds', {
      windowId: session.windowId,
      bounds: { windowState: 'normal', left: 0, top: 0, width: bounds.bounds.width + dx, height: bounds.bounds.height + dy }
    });
    await sleep(150);
  }
}

async function dismissConsent(page) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const clicked = await page.evaluate(() => {
      const root = document.querySelector('ytd-consent-bump-v2-lightbox');
      const button = [...(root?.querySelectorAll('button') || [])].find((item) => /reject all|odrzuć wszystko/i.test(item.innerText || ''));
      if (!button) return false;
      button.click();
      return true;
    });
    if (clicked) { await sleep(600); return; }
    await sleep(300);
  }
}

async function ensureDark(page) {
  await page.goto(config.videoUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('#movie_player', { timeout: 30000 });
  await dismissConsent(page);
  await page.waitForSelector('ytd-app', { timeout: 15000 });
  const theme = await page.evaluate(() => document.querySelector('ytd-app')?.getCurrentTheme?.() || null);
  if (theme === 'USER_INTERFACE_THEME_DARK') return theme;
  await page.evaluate(() => document.querySelector('ytd-app')?.handleSignalActionToggleDarkThemeOn());
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await sleep(800);
  return 'toggled';
}

async function installContextProbe(page) {
  await page.evaluate(() => {
    if (window.__teAudioHook) return;
    const Native = window.AudioContext;
    const seen = [];
    window.AudioContext = class extends Native { constructor(...args) { super(...args); seen.push(this); } };
    window.__teAudioContexts = seen;
    window.__teAudioHook = true;
  });
}

async function readNative(page) {
  return page.evaluate(() => {
    const player = document.querySelector('#movie_player');
    const flexy = document.querySelector('ytd-watch-flexy');
    const menu = (name) => document.querySelector(`[aria-label="${name}"]`)?.getAttribute('aria-checked') || null;
    return {
      drc: player?.getDrcUserPreference?.() ?? null,
      voicePref: player?.getVoiceBoostUserPreference?.() ?? null,
      voiceState: player?.getVoiceBoostState?.() ?? null,
      stableMenu: menu('Stable Volume') ?? menu('Stabilna głośność'),
      voiceMenu: menu('Voice boost') ?? menu('Wzmocnienie głosu'),
      cinematicActive: Boolean(flexy?.cinematicsActive),
      cinematicChildren: document.querySelector('#cinematics')?.childElementCount || 0,
      theme: document.querySelector('ytd-app')?.getCurrentTheme?.() || null
    };
  });
}

async function openSettings(page) {
  await page.locator('#movie_player').hover();
  const menu = page.locator('.ytp-settings-menu');
  if (!await menu.isVisible().catch(() => false)) {
    await page.locator('.ytp-settings-button').click();
    await menu.waitFor({ timeout: 5000 });
  }
}

async function setCheckbox(page, names, want) {
  await openSettings(page);
  const item = page.locator('.ytp-menuitem').filter({ hasText: new RegExp(names.join('|'), 'i') }).first();
  await item.waitFor({ timeout: 5000 });
  const aria = await item.getAttribute('aria-checked');
  if (aria == null) throw new Error(`menu item is not a checkbox: ${names.join('/')}`);
  if ((aria === 'true') !== want) await item.click();
  else await page.keyboard.press('Escape');
  await sleep(250);
}

async function forceAudible(page) {
  await page.evaluate(() => {
    const player = document.querySelector('#movie_player');
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    player?.unMute?.();
    player?.setVolume?.(100);
    if (video) { video.muted = false; video.volume = 1; }
  });
}

async function applyNative(page, want) {
  await setCheckbox(page, ['voice boost', 'wzmocnienie głosu'], false);
  await setCheckbox(page, ['stable volume', 'stabilna głośność'], want.stable);
  await setCheckbox(page, ['ambient mode', 'oświetlenie kinowe', 'tryb otoczenia'], want.cinematic);
  if (want.voice) await setCheckbox(page, ['voice boost', 'wzmocnienie głosu'], true);
  await page.keyboard.press('Escape').catch(() => {});
  await forceAudible(page);
  await sleep(300);
  return readNative(page);
}

async function readPlayer(page) {
  const native = await readNative(page);
  const player = await page.evaluate(() => {
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    const root = document.getElementById('theater-everywhere-ui')?.shadowRoot || null;
    const bar = root?.querySelector('.theater-controls-wrapper') || null;
    const slider = root?.querySelector('.theater-volume-slider') || null;
    const movie = document.querySelector('#movie_player');
    const quality = video?.getVideoPlaybackQuality?.() || null;
    let stats = null;
    try { stats = movie?.getVideoStats?.() || null; } catch { stats = null; }
    let data = null;
    try { data = movie?.getVideoData?.() || null; } catch { data = null; }
    return {
      href: location.href, title: document.title,
      theater: document.documentElement.classList.contains('theater-everywhere-html-active'),
      integrationOff: document.documentElement.hasAttribute('data-te-youtube-integration-off'),
      snapshot: Boolean(document.getElementById('theater-everywhere-youtube-snapshot')),
      heatmap: Boolean(root?.querySelector('.theater-scrubber-heatmap')),
      focus: document.hasFocus(), dpr: devicePixelRatio,
      inner: [innerWidth, innerHeight],
      screen: [screen.width, screen.height, screen.colorDepth],
      video: video ? {
        paused: video.paused, ended: video.ended, muted: video.muted, volume: video.volume,
        readyState: video.readyState, currentTime: video.currentTime, error: video.error?.message || null,
        width: video.videoWidth, height: video.videoHeight,
        boost: video.dataset.theaterBoost || null, voice: video.dataset.theaterVoice || null,
        leveling: video.dataset.theaterLeveling || null, bass: video.dataset.theaterBass || null,
        dropped: quality?.droppedVideoFrames ?? null, frames: quality?.totalVideoFrames ?? null
      } : null,
      barVisible: Boolean(bar?.classList.contains('visible')),
      slider: slider ? { value: slider.value, max: slider.max, focused: root.activeElement === slider } : null,
      contexts: (window.__teAudioContexts || []).map((ctx) => ctx.state),
      ad: Boolean(document.querySelector('.ad-showing, .ytp-ad-player-overlay')),
      quality: movie?.getPlaybackQuality?.() || null,
      playerState: movie?.getPlayerState?.() ?? null,
      videoId: data?.video_id || null,
      stats: stats ? { fmt: stats.fmt, afmt: stats.afmt, vvol: stats.vvol, muted: stats.muted, volume: stats.volume, vw: stats.vw, vh: stats.vh } : null
    };
  });
  player.native = native;
  return player;
}

async function armYoutube(page) {
  await page.evaluate(() => {
    const player = document.querySelector('#movie_player');
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!player || !video) return;
    const levels = player.getAvailableQualityLevels?.() || [];
    if (levels.includes('medium') && player.getPlaybackQuality?.() !== 'medium') {
      player.setPlaybackQualityRange?.('medium', 'medium');
      player.setPlaybackQuality?.('medium');
    }
    if (video.currentTime < 9 || video.currentTime > 16) player.seekTo?.(10, true);
    video.muted = false;
    video.volume = 1;
    if (video.paused) player.playVideo?.();
  });
}

async function openYoutube(page) {
  await page.goto(config.videoUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await dismissConsent(page);
  await page.waitForSelector('#movie_player', { timeout: 30000 });
  await page.evaluate(() => {
    const payload = { volume: 100, muted: false };
    localStorage.setItem('yt-player-volume', JSON.stringify({ data: JSON.stringify(payload), expiration: Date.now() + 1e11, creation: Date.now() }));
  });
  await installContextProbe(page);
  await armYoutube(page);
  let last = null;
  const deadline = Date.now() + 35000;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => {
      const player = document.querySelector('#movie_player');
      const video = document.querySelector('video.html5-main-video');
      return {
        quality: player?.getPlaybackQuality?.(), paused: video?.paused, time: video?.currentTime,
        ready: video?.readyState, width: video?.videoWidth, height: video?.videoHeight,
        ad: Boolean(document.querySelector('.ad-showing, .ytp-ad-player-overlay'))
      };
    });
    if (last.ad) { await sleep(1000); continue; }
    if (last.paused || last.ready < 3 || last.quality !== 'medium' || last.time < 9 || last.time > 16) await armYoutube(page);
    const aligned = !last.ad && !last.paused && last.ready >= 3 && last.quality === 'medium' && last.width === 640 && last.height === 360 && last.time >= 9 && last.time <= 16;
    if (aligned) {
      const start = last.time;
      await sleep(1500);
      const next = await page.evaluate(() => {
        const video = document.querySelector('video.html5-main-video');
        const player = document.querySelector('#movie_player');
        return { paused: video?.paused, time: video?.currentTime, quality: player?.getPlaybackQuality?.(), width: video?.videoWidth, height: video?.videoHeight, ad: Boolean(document.querySelector('.ad-showing')) };
      });
      if (!next.paused && next.time >= start + 0.8 && next.quality === 'medium' && next.width === 640 && next.height === 360 && !next.ad) return next;
    }
    await sleep(400);
  }
  throw new Error(`youtube not ready: ${JSON.stringify(last)}`);
}

function settingsFor(state) {
  if (state === 'active' || state === 'paused') return { voiceBoost: 'strong', volumeLeveling: 'strong', bassLevel: 'more', volumeBoostEnabled: false, youtubeIntegrationEnabled: true };
  if (state.startsWith('boost')) return { voiceBoost: 'off', volumeLeveling: 'off', bassLevel: 'original', volumeBoostEnabled: true, youtubeIntegrationEnabled: true };
  return { voiceBoost: 'off', volumeLeveling: 'off', bassLevel: 'original', volumeBoostEnabled: false, youtubeIntegrationEnabled: true };
}

async function setStorage(worker, settings) {
  await worker.evaluate((value) => chrome.storage.sync.set(value), settings);
}

async function enterTheater(page) {
  await installContextProbe(page);
  let state = await readPlayer(page);
  if (state.video?.paused) await page.keyboard.press('Space');
  if (!state.theater) {
    await page.keyboard.press('t');
    await page.waitForFunction(() => document.documentElement.classList.contains('theater-everywhere-html-active'), null, { timeout: 8000 }).catch(() => {});
  }
  state = await readPlayer(page);
  if (!state.theater) {
    await page.keyboard.press('t');
    await page.waitForFunction(() => document.documentElement.classList.contains('theater-everywhere-html-active'), null, { timeout: 8000 });
  }
  return readPlayer(page);
}

async function focusSlider(page) {
  await page.locator('.theater-volume-slider').waitFor({ timeout: 5000 });
  for (let i = 0; i < 25; i++) {
    const focused = await page.evaluate(() => {
      const root = document.getElementById('theater-everywhere-ui')?.shadowRoot;
      const slider = root?.querySelector('.theater-volume-slider');
      return Boolean(slider && root.activeElement === slider && slider.matches(':focus-visible'));
    });
    if (focused) break;
    await page.keyboard.press('Tab');
    await sleep(40);
  }
  await sleep(2800);
}

async function hideBar(page) {
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.mouse.move(720, 280);
  await sleep(3200);
}

async function raiseBoost(page) {
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); document.body.focus(); });
  for (let i = 0; i < 16; i++) {
    const state = await readPlayer(page);
    if (state.video?.boost === '3.0000' && Number(state.slider?.value) >= 1.49) return;
    await page.keyboard.press('ArrowUp');
    await sleep(80);
  }
}

async function applyExtension(session, state) {
  await setStorage(session.worker, state === 'disabled' ? settingsFor('active') : settingsFor(state));
  await sleep(300);
  await enterTheater(session.page);
  await session.page.waitForFunction(() => {
    const root = document.getElementById('theater-everywhere-ui')?.shadowRoot;
    return Boolean(document.getElementById('theater-everywhere-youtube-snapshot') || root?.querySelector('.theater-scrubber-heatmap'));
  }, null, { timeout: 8000 }).catch(() => {});
  if (state.startsWith('boost')) {
    await raiseBoost(session.page);
    if (state === 'boost-focused') await focusSlider(session.page);
    else await hideBar(session.page);
  }
  if (state === 'paused') {
    await session.page.waitForFunction(() => (window.__teAudioContexts || []).some((ctx) => ctx.state === 'running'), null, { timeout: 5000 }).catch(() => {});
    const before = await readPlayer(session.page);
    if (!before.video?.paused) await session.page.keyboard.press('Space');
    await session.page.waitForFunction(() => document.querySelector('video.html5-main-video')?.paused, null, { timeout: 5000 });
  }
  if (state === 'disabled') {
    await session.page.waitForFunction(() => (window.__teAudioContexts || []).some((ctx) => ctx.state === 'running'), null, { timeout: 5000 }).catch(() => {});
    await setStorage(session.worker, settingsFor('neutral'));
    await session.page.waitForFunction(() => {
      const video = document.querySelector('video.html5-main-video');
      return video && video.dataset.theaterVoice === 'off' && !video.paused;
    }, null, { timeout: 8000 });
  }
}

function flagOn(menu, pref) {
  if (menu === 'true') return true;
  if (menu === 'false') return false;
  return pref === true || pref === 'true' || pref === '1' || pref === '2' || (typeof pref === 'number' && pref > 0);
}

function nativeMatches(state, native) {
  const want = NATIVE_WANT[state];
  const stable = flagOn(native.stableMenu, native.drc);
  const voice = flagOn(native.voiceMenu, native.voicePref);
  const cinematic = Boolean(native.cinematicActive);
  if (cinematic !== want.cinematic) return `cinematic ${cinematic}`;
  if (want.cinematic && native.cinematicChildren < 1) return 'cinematic container empty';
  if (voice !== want.voice) return `voice boost ${voice}`;
  if (stable !== want.stable) {
    if (want.allowStableForcedOff && want.voice && voice && !stable) return null;
    return `stable volume ${stable}`;
  }
  return null;
}

function familyOf(type) {
  const value = type.toLowerCase();
  if (value === 'browser') return 'browser';
  if (value === 'renderer') return 'renderer';
  if (value === 'gpu') return 'gpu';
  if (value.includes('extension')) return 'extension';
  return 'utility';
}

async function measureWindow(session) {
  const cdp = await session.context.newCDPSession(session.page);
  await cdp.send('Performance.enable');
  await sleep(200);
  const pre = await readPlayer(session.page);
  const metricsBefore = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((metric) => [metric.name, metric.value]));
  const processesBefore = (await session.browserCdp.send('SystemInfo.getProcessInfo')).processInfo;
  const statBefore = readProcStat();
  const chromeBefore = chromeCpuSnapshot();
  const wallBefore = process.hrtime.bigint();
  for (let i = 0; i < 4; i++) await sleep(config.windowMs / 4);
  const wallAfter = process.hrtime.bigint();
  const metricsAfter = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((metric) => [metric.name, metric.value]));
  const processesAfter = (await session.browserCdp.send('SystemInfo.getProcessInfo')).processInfo;
  const statAfter = readProcStat();
  const chromeAfter = chromeCpuSnapshot();
  const post = await readPlayer(session.page);
  await cdp.detach().catch(() => {});
  const wallSec = Number(wallAfter - wallBefore) / 1e9;
  const beforeById = new Map(processesBefore.map((proc) => [proc.id, proc]));
  const groups = { browser: 0, renderer: 0, gpu: 0, utility: 0, extension: 0 };
  const appeared = processesAfter.filter((proc) => !beforeById.has(proc.id)).map((proc) => proc.type);
  const disappeared = processesBefore.filter((proc) => !processesAfter.some((item) => item.id === proc.id)).map((proc) => proc.type);
  for (const proc of processesAfter) {
    const prev = beforeById.get(proc.id);
    if (!prev) continue;
    groups[familyOf(proc.type)] += proc.cpuTime - prev.cpuTime;
  }
  const pct = (seconds) => 100 * seconds / wallSec;
  const machine = machineBusyPercent(statBefore, statAfter, wallSec);
  const chromeBeforeTicks = new Map(chromeBefore.map((row) => [row.pid, row.ticks]));
  let chromeTicks = 0;
  let chromePidChanges = 0;
  for (const row of chromeAfter) {
    const prev = chromeBeforeTicks.get(row.pid);
    if (prev == null) { chromePidChanges += 1; continue; }
    chromeTicks += row.ticks - prev;
  }
  for (const row of chromeBefore) if (!chromeAfter.some((item) => item.pid === row.pid)) chromePidChanges += 1;
  const chromeProcPct = 100 * (chromeTicks / CLK_TCK) / wallSec;
  return {
    wallSec,
    rendererPct: pct((metricsAfter.ProcessTime ?? 0) - (metricsBefore.ProcessTime ?? 0)),
    threadPct: pct((metricsAfter.ThreadTime ?? 0) - (metricsBefore.ThreadTime ?? 0)),
    familyPct: pct(Object.values(groups).reduce((sum, value) => sum + value, 0)),
    groups: { browser: pct(groups.browser), renderer: pct(groups.renderer), gpu: pct(groups.gpu), utility: pct(groups.utility), extension: pct(groups.extension) },
    machinePct: machine, chromeProcPct, chromePidChanges,
    nonChromePct: machine == null ? null : Math.max(0, machine - chromeProcPct),
    processSetChanged: appeared.length > 0 || disappeared.length > 0,
    appeared, disappeared, pre, post
  };
}

function rejectReason(state, sample, threshold) {
  const pre = sample.pre;
  const post = sample.post;
  if (!pre?.video || !post?.video) return 'missing video';
  if (pre.video.error || post.video.error) return `media error ${post.video.error || pre.video.error}`;
  if (!Number.isFinite(sample.rendererPct) || sample.rendererPct < 0) return 'invalid renderer counter';
  if (Math.abs(sample.wallSec - config.windowMs / 1000) > 1.5) return `window length ${sample.wallSec.toFixed(3)}s`;
  if (sample.nonChromePct > threshold) return `external load ${sample.nonChromePct.toFixed(1)}% > ${threshold.toFixed(1)}%`;
  if (EXTENSION_STATES.has(state) && (!pre.theater || !post.theater)) return 'theater inactive';
  if (!EXTENSION_STATES.has(state) && (pre.theater || post.theater)) return 'theater unexpectedly active';
  if (pre.video.muted || post.video.muted) return 'video muted';
  if (pre.video.volume < 0.99 || post.video.volume < 0.99) return 'volume below 100%';
  if (pre.ad || post.ad) return 'advertisement';
  if (pre.videoId !== config.videoId || post.videoId !== config.videoId) return `video id ${pre.videoId}`;
  if (pre.quality !== 'medium' || post.quality !== 'medium') return `quality ${pre.quality}->${post.quality}`;
  if (pre.video.width !== 640 || pre.video.height !== 360 || post.video.width !== 640 || post.video.height !== 360) return `size ${pre.video.width}x${pre.video.height}`;
  if (pre.stats?.fmt && post.stats?.fmt && (pre.stats.fmt !== post.stats.fmt || pre.stats.afmt !== post.stats.afmt)) return `codec ${pre.stats.fmt}/${pre.stats.afmt}`;
  const native = nativeMatches(state, pre.native) || nativeMatches(state, post.native);
  if (native) return native;
  if (state === 'paused') {
    if (!pre.video.paused || !post.video.paused) return 'pause not stable';
    if (Math.abs(post.video.currentTime - pre.video.currentTime) > 0.35) return 'paused time moved';
  } else {
    if (pre.video.paused || post.video.paused) return 'playback not running';
    if (post.video.currentTime < pre.video.currentTime + 15) return `time advanced ${(post.video.currentTime - pre.video.currentTime).toFixed(2)}s`;
    if (pre.video.readyState < 3 || post.video.readyState < 3) return 'readyState below 3';
  }
  if (EXTENSION_STATES.has(state) && (!pre.snapshot && !pre.heatmap)) return 'RTE DOM signal absent';
  if ((state === 'neutral' || state === 'disabled') && pre.video.voice !== 'off') return 'effects not neutral';
  if (state.startsWith('boost')) {
    if (pre.video.boost !== '3.0000' || post.video.boost !== '3.0000') return `boost ${pre.video.boost}`;
    if (state === 'boost-focused' && !pre.barVisible) return 'boost bar hidden during focused variant';
    if (state === 'boost-hidden' && pre.barVisible) return 'boost bar visible during hidden variant';
  }
  if ((state === 'active' || state === 'paused') && (pre.video.voice !== 'strong' || pre.video.leveling !== 'strong' || pre.video.bass !== 'more')) return 'active effects not set';
  return null;
}

function record(row) {
  mkdirSync(config.outDir, { recursive: true });
  appendFileSync(`${config.outDir}/samples.jsonl`, `${JSON.stringify(row)}\n`);
}

async function oneSample(session, state, index, threshold) {
  await openYoutube(session.page);
  const native = await applyNative(session.page, NATIVE_WANT[state]);
  if (EXTENSION_STATES.has(state)) await applyExtension(session, state);
  await forceAudible(session.page);
  const warmupStart = await readPlayer(session.page);
  await sleep(config.warmupMs);
  const warmupEnd = await readPlayer(session.page);
  if (state === 'paused') {
    if (!warmupEnd.video?.paused || Math.abs(warmupEnd.video.currentTime - warmupStart.video.currentTime) > 0.35) {
      return { accepted: false, rejectReason: 'pause drifted during warmup', native, warmupStart, warmupEnd };
    }
  } else if (warmupEnd.video && warmupStart.video && warmupEnd.video.currentTime < warmupStart.video.currentTime + 4) {
    return { accepted: false, rejectReason: 'playback stalled during warmup', native, warmupStart, warmupEnd };
  }
  const sample = await measureWindow(session);
  sample.state = state;
  sample.build = session.build?.name || 'native';
  sample.sha = session.build?.sha || null;
  sample.mainWorldSha256 = session.build?.mainWorldSha256 || null;
  sample.index = index;
  sample.mode = 'headed';
  sample.surface = 'youtube';
  sample.videoId = config.videoId;
  const reason = rejectReason(state, sample, threshold);
  sample.accepted = !reason;
  sample.rejectReason = reason;
  return sample;
}

async function runSlot(state, index, threshold) {
  let last = null;
  for (let attempt = 1; attempt <= config.attempts; attempt++) {
    let session = null;
    try {
      session = await launchBrowser(state);
      await fitViewport(session);
      await ensureDark(session.page);
      if (session.worker) {
        const id = new URL(session.worker.url()).host;
        const manifest = await session.worker.evaluate(() => chrome.runtime.getManifest());
        log(state, index, 'worker', id, manifest.version, session.build.sha.slice(0, 12));
      }
      last = await oneSample(session, state, index, threshold);
      last.attempt = attempt;
      record(last);
      log(state, `#${index}`, last.accepted ? `ok renderer ${last.rendererPct.toFixed(2)} family ${last.familyPct.toFixed(2)} gpu ${last.groups.gpu.toFixed(2)}` : `reject ${last.rejectReason}`);
      if (last.accepted) return last;
    } catch (error) {
      last = { accepted: false, rejectReason: String(error?.stack || error).slice(0, 800), state, build: buildFor(state)?.name || 'native', index, attempt, mode: 'headed', surface: 'youtube' };
      record(last);
      log(state, `#${index}`, 'error', last.rejectReason.split('\n')[0]);
    } finally {
      await session?.context.close().catch(() => {});
    }
  }
  return last;
}

async function observeLoad() {
  log('background load, 60s');
  const samples = [];
  let prev = readProcStat();
  let prevAt = process.hrtime.bigint();
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const now = readProcStat();
    const at = process.hrtime.bigint();
    samples.push({ busyPctOneCore: machineBusyPercent(prev, now, Number(at - prevAt) / 1e9), load: loadavg() });
    prev = now;
    prevAt = at;
  }
  const busy = samples.map((sample) => sample.busyPctOneCore);
  const summary = {
    started: new Date().toISOString(), seconds: 60, samples,
    medianBusyPctOneCore: median(busy), p95BusyPctOneCore: percentile(busy, 0.95), maxBusyPctOneCore: Math.max(...busy)
  };
  summary.externalThresholdPctOneCore = Math.max(summary.p95BusyPctOneCore * 2, summary.p95BusyPctOneCore + 40);
  return summary;
}

async function run() {
  const states = process.argv.includes('--states') ? process.argv[process.argv.indexOf('--states') + 1].split(',') : config.states;
  for (const state of states) if (!NATIVE_WANT[state]) throw new Error(`unknown state ${state}`);
  await ensureDisplay();
  mkdirSync(config.outDir, { recursive: true });
  const load = await observeLoad();
  const conditions = {
    measuredAt: new Date().toISOString(), config, load, threshold: load.externalThresholdPctOneCore,
    chrome: CHROME, mem: meminfo(), host: execFileSync('uname', ['-a'], { encoding: 'utf8' }).trim(),
    extension: buildFor('neutral')
  };
  writeFileSync(`${config.outDir}/conditions.json`, JSON.stringify(conditions, null, 2));
  log('threshold', load.externalThresholdPctOneCore.toFixed(2), 'median', load.medianBusyPctOneCore.toFixed(2));
  const accepted = Object.fromEntries(states.map((state) => [state, []]));
  for (let round = 0; round < config.rounds; round++) {
    const order = round % 2 === 0 ? states : [...states].reverse();
    for (const state of order) {
      if (accepted[state].length >= config.rounds) continue;
      const sample = await runSlot(state, accepted[state].length + 1, load.externalThresholdPctOneCore);
      if (sample?.accepted) accepted[state].push(sample);
    }
  }
  for (const state of states) {
    let misses = 0;
    while (accepted[state].length < config.rounds && misses < 2) {
      const sample = await runSlot(state, accepted[state].length + 1, load.externalThresholdPctOneCore);
      if (sample?.accepted) accepted[state].push(sample);
      else misses += 1;
    }
  }
  for (const state of states) {
    const values = accepted[state].map((sample) => sample.rendererPct);
    if (values.length >= 3 && (Math.max(...values) - Math.min(...values)) > config.scatterPp) {
      log('scatter', state, values.map((value) => value.toFixed(2)).join(','));
      for (let extra = 0; extra < config.scatterExtra && accepted[state].length < config.rounds + config.scatterExtra; extra++) {
        const sample = await runSlot(state, accepted[state].length + 1, load.externalThresholdPctOneCore);
        if (sample?.accepted) accepted[state].push(sample);
      }
    }
  }
  writeReport();
  log('suite finished', config.outDir);
}

async function probe() {
  await ensureDisplay();
  const session = await launchBrowser('reference');
  try {
    await fitViewport(session);
    await ensureDark(session.page);
    const checks = [];
    for (const state of ['reference', 'native-cinematic', 'native-voice', 'native-stable', 'native-all']) {
      await openYoutube(session.page);
      const native = await applyNative(session.page, NATIVE_WANT[state]);
      const mismatch = nativeMatches(state, native);
      checks.push({ state, mismatch, native });
      log('probe', state, mismatch || 'ok', JSON.stringify(native));
    }
    mkdirSync(config.outDir, { recursive: true });
    writeFileSync(`${config.outDir}/probe.json`, JSON.stringify(checks, null, 2));
  } finally {
    await session.context.close();
  }
}

function writeReport() {
  const rows = existsSync(`${config.outDir}/samples.jsonl`)
    ? readFileSync(`${config.outDir}/samples.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : [];
  const accepted = rows.filter((row) => row.accepted && Number.isFinite(row.rendererPct));
  const groups = new Map();
  for (const row of accepted) {
    const key = row.state;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const line = (label, items) => {
    const rend = items.map((item) => item.rendererPct);
    const fam = items.map((item) => item.familyPct);
    const gpu = items.map((item) => item.groups.gpu);
    const fmt = (values) => `${median(values).toFixed(2)} (${Math.min(...values).toFixed(2)}–${Math.max(...values).toFixed(2)}) n=${values.length}`;
    return `| ${label} | ${fmt(rend)} | ${fmt(fam)} | ${fmt(gpu)} |`;
  };
  const rejected = rows.filter((row) => !row.accepted);
  const body = [
    `# Suite YouTube — ${config.videoId}`,
    '',
    `Rozszerzenie: ${config.extension.name} \`${config.extension.sha || 'unknown'}\`. Film: ${config.videoUrl}.`,
    'Natywny baseline to oświetlenie kinowe (tryb otoczenia przy ciemnym motywie), wzmocnienie głosu i stabilna głośność. Stany rozszerzenia mają te trzy opcje wyłączone.',
    'YouTube przy włączonym wzmocnieniu głosu samo wyłącza stabilną głośność; `native-all` zapisuje ten wynik, jeśli głos i oświetlenie są włączone.',
    '',
    '| Stan | Renderer | Rodzina | Proces GPU |',
    '|---|---|---|---|',
    ...config.states.filter((state) => groups.has(state)).map((state) => line(state, groups.get(state))),
    '',
    `Przyjęte ${accepted.length}, odrzucone ${rejected.length}.`,
    ...rejected.map((row) => `- ${row.state} #${row.index} próba ${row.attempt}: ${row.rejectReason}`)
  ];
  writeFileSync(`${config.outDir}/SUMMARY.md`, `${body.join('\n')}\n`);
  const header = ['state', 'build', 'index', 'attempt', 'accepted', 'rejectReason', 'rendererPct', 'familyPct', 'gpuPct', 'threadPct', 'wallSec', 'quality', 'width', 'height', 'videoId', 'fmt', 'afmt', 'cinematic', 'voice', 'stable'];
  const csv = [header.join(',')];
  for (const row of rows) {
    csv.push([
      row.state, row.build, row.index, row.attempt, row.accepted, JSON.stringify(row.rejectReason || ''),
      row.rendererPct ?? '', row.familyPct ?? '', row.groups?.gpu ?? '', row.threadPct ?? '', row.wallSec ?? '',
      row.post?.quality ?? '', row.post?.video?.width ?? '', row.post?.video?.height ?? '', row.post?.videoId ?? '',
      row.post?.stats?.fmt ?? '', row.post?.stats?.afmt ?? '',
      row.post?.native?.cinematicActive ?? '', row.post?.native?.voiceMenu ?? '', row.post?.native?.stableMenu ?? ''
    ].join(','));
  }
  writeFileSync(`${config.outDir}/samples.csv`, `${csv.join('\n')}\n`);
  log('report', `${config.outDir}/SUMMARY.md`);
}

async function topUp() {
  await ensureDisplay();
  const conditions = JSON.parse(readFileSync(`${config.outDir}/conditions.json`, 'utf8'));
  const threshold = conditions.threshold;
  const rows = readFileSync(`${config.outDir}/samples.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const accepted = Object.fromEntries(config.states.map((state) => [state, rows.filter((row) => row.accepted && row.state === state)]));
  for (const state of config.states) {
    let misses = 0;
    while (accepted[state].length < config.rounds && misses < 2) {
      log('top-up', state, `${accepted[state].length}/${config.rounds}`);
      const sample = await runSlot(state, accepted[state].length + 1, threshold);
      if (sample?.accepted) accepted[state].push(sample);
      else misses += 1;
    }
  }
  writeReport();
}

const command = process.argv[2] || 'run';
const action = command === 'probe' ? probe : command === 'report' ? writeReport : command === 'topup' ? topUp : run;
action().catch((error) => { console.error(error); process.exit(1); });
