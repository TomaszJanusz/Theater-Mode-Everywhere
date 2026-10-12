import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { chromium, type BrowserContext, type CDPSession, type Page, type Worker } from 'playwright';
import { BASS_LEVELS, DEFAULT_AUDIO_SETTINGS, LEVELING_LEVELS, VOICE_LEVELS, isNeutralAudio } from '../../src/audio-settings';
import { checkPlayer, checkState } from './validation';
import { activeAudio, type Build, type Environment, type PlayerSnapshot, type Scenario, type State, type VideoSpec } from './model';
import { Resources, waitFor } from './processes';

// These are optional host APIs, never assumed to be present. Values returned by
// YouTube are checked before entering the shared measurement model.
interface YoutubePlayer extends HTMLElement {
  getPlayerResponse?(): unknown; getVideoData?(): unknown; getVideoStats?(): unknown; getPlaybackQuality?(): unknown;
  getAvailableQualityLevels?(): unknown; setPlaybackQualityRange?(min: string, max: string): void;
  setPlaybackQuality?(quality: string): void; seekTo?(time: number, allowSeekAhead: boolean): void;
  playVideo?(): void; unMute?(): void; setVolume?(volume: number): void;
  getVolume?(): unknown; getDrcUserPreference?(): unknown; getVoiceBoostUserPreference?(): unknown;
}
interface YoutubeApp extends HTMLElement { getCurrentTheme?(): unknown; handleSignalActionToggleDarkThemeOn?(): void }
interface YoutubeFlexy extends HTMLElement { cinematicsActive?: unknown }
type Probe = { token(video: HTMLVideoElement): number; graphs: WeakMap<HTMLMediaElement, { context: AudioContext; gain: GainNode | null }>;
  documentId: string; restoration: { element: Element; style: string | null }[] | null };
declare global { interface Window { __cpuSuiteProbe?: Probe; ytInitialPlayerResponse?: unknown } }
export type Session = { context: BrowserContext; page: Page; browserCdp: CDPSession; pageCdp: CDPSession;
  worker: Worker | null; close(): Promise<void> };

export function installProbe(): void {
  if (window.__cpuSuiteProbe) return;
  const tokens = new WeakMap<HTMLVideoElement, { id: number; src: string }>();
  let next = 1;
  const graphs: Probe['graphs'] = new WeakMap();
  const Native = window.AudioContext;
  window.__cpuSuiteProbe = { graphs, documentId: String(Math.random()), restoration: null,
    token(video) {
      const src = video.currentSrc || video.src;
      let token = tokens.get(video);
      if (!token || token.src !== src) { token = { id: next++, src }; tokens.set(video, token); }
      return token.id;
    } };
  // The product constructs its terminal boost GainNode immediately before its
  // MediaElementSource. Capture that node per source, not a global context list.
  if (Native) window.AudioContext = class extends Native {
    private gains: GainNode[] = [];
    override createGain(): GainNode { const node = super.createGain(); this.gains.push(node); return node; }
    override createMediaElementSource(media: HTMLMediaElement): MediaElementAudioSourceNode {
      const source = super.createMediaElementSource(media);
      graphs.set(media, { context: this, gain: this.gains.at(-1) ?? null });
      return source;
    }
  };
}
// tsx preserves function names using a helper; Playwright serializes callbacks
// without their module scope. Install it before the probe and later evaluations.
export const PROBE_SCRIPT = `globalThis.__name = target => target; (${installProbe.toString()})();`;
export async function readPlayer(page: Page): Promise<PlayerSnapshot> {
  return page.evaluate(settings => {
    const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const text = (value: unknown): string | null => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : null;
    const boolean = (value: unknown): boolean | null => {
      if (value === true || value === 'true' || value === '1' || value === '2' || (typeof value === 'number' && value > 0)) return true;
      if (value === false || value === 'false' || value === '0' || value === 0) return false;
      return null;
    };
    const movie = document.querySelector<YoutubePlayer>('#movie_player');
    const video = document.querySelector<HTMLVideoElement>('video.html5-main-video');
    const root = document.getElementById('theater-everywhere-ui')?.shadowRoot;
    const slider = root?.querySelector<HTMLInputElement>('.theater-volume-slider');
    const stats = record(movie?.getVideoStats?.()), data = record(movie?.getVideoData?.());
    const flexy = document.querySelector<YoutubeFlexy>('ytd-watch-flexy');
    const menu = (names: string[]) => {
      const item = [...document.querySelectorAll('.ytp-menuitem')].find(item => names.some(name => (item.getAttribute('aria-label') || item.textContent || '').toLowerCase().includes(name)));
      return item ? boolean(item.getAttribute('aria-checked')) : null;
    };
    const graph = video ? window.__cpuSuiteProbe?.graphs.get(video) : null;
    const quality = video?.getVideoPlaybackQuality();
    let rteSignal = false;
    try {
      const snapshot: unknown = JSON.parse(document.getElementById('theater-everywhere-youtube-snapshot')?.textContent || 'null');
      rteSignal ||= record(snapshot).videoId === data.video_id && typeof data.video_id === 'string';
    } catch { /* missing/invalid signal remains unavailable */ }
    const voice = settings.voice.find(level => level === (video?.dataset.theaterVoice ?? settings.defaults.voice));
    const leveling = settings.leveling.find(level => level === (video?.dataset.theaterLeveling ?? settings.defaults.leveling));
    const bass = settings.bass.find(level => level === (video?.dataset.theaterBass ?? settings.defaults.bass));
    const audio = video && voice && leveling && bass ? { voice, leveling, bass } : null;
    const response = record(movie?.getPlayerResponse?.() ?? window.ytInitialPlayerResponse);
    const formats = record(response.videoDetails).videoId === data.video_id ? record(response.streamingData).adaptiveFormats : null;
    const format = Array.isArray(formats) ? formats.map(record).find(f => text(f.itag) === text(stats.fmt)) : null;
    const fps = typeof format?.fps === 'number' ? format.fps : typeof stats.fps === 'number' ? stats.fps : typeof stats.fps === 'string' && /^\d+(\.\d+)?$/.test(stats.fps) ? Number(stats.fps) : null;
    const boost = video?.dataset.theaterBoost;
    return {
      href: location.href, videoId: typeof data.video_id === 'string' ? data.video_id : null,
      videoToken: video ? window.__cpuSuiteProbe?.token(video) ?? null : null,
      theater: document.documentElement.classList.contains('theater-everywhere-html-active'),
      integrationOff: document.documentElement.hasAttribute('data-te-youtube-integration-off'), rteSignal,
      focus: document.hasFocus(), inner: [innerWidth, innerHeight], dpr: devicePixelRatio,
      barVisible: Boolean(root?.querySelector('.theater-controls-wrapper')?.classList.contains('visible')),
      sliderFocused: Boolean(slider && root?.activeElement === slider), sliderFocusVisible: Boolean(slider?.matches(':focus-visible')),
      ad: Boolean(document.querySelector('.ad-showing, .ytp-ad-player-overlay')),
      nativeVolume: typeof movie?.getVolume?.() === 'number' ? Number(movie.getVolume()) : null,
      quality: text(movie?.getPlaybackQuality?.()), fmt: text(stats.fmt), afmt: text(stats.afmt), streamFps: fps,
      native: { stable: menu(['stable volume', 'stabilna głośność']) ?? boolean(movie?.getDrcUserPreference?.()),
        voice: menu(['voice boost', 'wzmocnienie głosu']) ?? boolean(movie?.getVoiceBoostUserPreference?.()),
        cinematic: typeof flexy?.cinematicsActive === 'boolean' ? flexy.cinematicsActive : menu(['ambient mode', 'oświetlenie kinowe', 'tryb otoczenia']),
        cinematicChildren: document.querySelector('#cinematics')?.childElementCount ?? 0,
        theme: text(document.querySelector<YoutubeApp>('ytd-app')?.getCurrentTheme?.()) },
      video: video ? { paused: video.paused, muted: video.muted, volume: video.volume, readyState: video.readyState,
        currentTime: video.currentTime, rate: video.playbackRate, error: video.error?.message || null,
        width: video.videoWidth, height: video.videoHeight, boost: boost == null ? 1 : Number.isFinite(Number(boost)) ? Number(boost) : null,
        audio, graphReady: video.dataset.theaterBoostReady === 'true',
        graph: graph ? { state: graph.context.state, gain: graph.gain?.gain.value ?? null } : null,
        dropped: quality?.droppedVideoFrames ?? null, frames: quality?.totalVideoFrames ?? null } : null
    };
  }, { defaults: DEFAULT_AUDIO_SETTINGS, voice: VOICE_LEVELS, leveling: LEVELING_LEVELS, bass: BASS_LEVELS });
}
export async function launchBrowser(root: string, chrome: string, build: Build | null, resources: Resources,
  diagnostics: string, prepare?: (session: Session) => Promise<void>): Promise<Session> {
  mkdirSync(root, { recursive: true });
  const args = ['--disable-dev-shm-usage', '--mute-audio', '--window-size=1600,1000', '--window-position=0,0'];
  if (process.getuid?.() === 0) args.push('--no-sandbox');
  if (build) args.push(`--disable-extensions-except=${build.path}`, `--load-extension=${build.path}`);
  const context = await chromium.launchPersistentContext(root, { headless: false, executablePath: chrome, viewport: null, args });
  const unregister = resources.add(() => context.close());
  const logs: string[] = [];
  const page = context.pages()[0] ?? await context.newPage();
  page.on('pageerror', error => { logs.push(String(error).slice(0, 1000)); if (logs.length > 20) logs.shift(); });
  page.on('console', message => { if (message.type() === 'error') { logs.push(message.text().slice(0, 1000)); if (logs.length > 20) logs.shift(); } });
  try {
    await context.addInitScript({ content: PROBE_SCRIPT });
    await page.evaluate(PROBE_SCRIPT);
    // Only the locator handler dismisses consent: explicitly clicking its own
    // target outside the handler would dismiss it twice and wait for a vanished button.
    await installConsentHandler(page);
    for (const extra of context.pages().slice(1)) await extra.close();
    const browser = context.browser();
    if (!browser) throw new Error('Persistent browser CDP unavailable');
    const browserCdp = await browser.newBrowserCDPSession(), pageCdp = await context.newCDPSession(page);
    let worker: Worker | null = null;
    if (build) worker = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'))
      ?? await context.waitForEvent('serviceworker', { timeout: 15000 });
    const session: Session = { context, page, browserCdp, pageCdp, worker,
      async close() { await context.close(); unregister(); } };
    await fitViewport(session);
    if (prepare) await prepare(session);
    return session;
  } catch (error) {
    try { await captureDiagnostics(page, diagnostics, error, logs); } finally { await context.close(); unregister(); }
    throw error;
  }
}
export async function captureDiagnostics(page: Page, prefix: string, error: unknown, logs: string[] = []): Promise<void> {
  mkdirSync(path.dirname(prefix), { recursive: true });
  const snapshot = await readPlayer(page).catch(() => null);
  writeFileSync(`${prefix}.log`, [(error instanceof Error ? error.stack ?? error.message : String(error)).slice(0, 4000),
    JSON.stringify(snapshot).slice(0, 5000), ...logs].join('\n'));
  await page.screenshot({ path: `${prefix}.png`, timeout: 3000 }).catch(() => {});
}
async function fitViewport(session: Session): Promise<void> {
  const target = await session.pageCdp.send('Target.getTargetInfo');
  const { windowId } = await session.browserCdp.send('Browser.getWindowForTarget', { targetId: target.targetInfo.targetId });
  await waitFor(async () => {
    const size = await session.page.evaluate(() => [innerWidth, innerHeight]);
    const dx = 1440 - size[0], dy = 900 - size[1];
    if (dx === 0 && dy === 0) return true;
    const { bounds } = await session.browserCdp.send('Browser.getWindowBounds', { windowId });
    if (bounds.width == null || bounds.height == null) throw new Error('Browser window dimensions unavailable');
    await session.browserCdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal', left: 0, top: 0,
      width: bounds.width + dx, height: bounds.height + dy } });
    return false;
  }, 5000);
}
export async function environment(session: Session, chrome: string, backend: string): Promise<Environment> {
  const version = await session.browserCdp.send('Browser.getVersion');
  let gpu: unknown = null;
  try {
    const info = (await session.browserCdp.send('SystemInfo.getInfo')).gpu;
    gpu = { devices: info.devices, renderer: info.auxAttributes?.glRenderer ?? null, vendor: info.auxAttributes?.glVendor ?? null,
      version: info.auxAttributes?.glVersion ?? null, featureStatus: info.featureStatus };
  } catch { /* explicitly unavailable */ }
  const dpr = await session.page.evaluate(() => devicePixelRatio);
  return { platform: os.platform(), host: execFileSync('uname', ['-sr'], { encoding: 'utf8' }).trim(),
    cpu: os.cpus()[0]?.model ?? 'unavailable', cores: os.cpus().length, memoryBytes: os.totalmem(), chromePath: chrome,
    chromeVersion: String(version.product), displayBackend: backend, gpu, viewport: [1440, 900], dpr, audioMutedByBrowser: true };
}
function consentButton(page: Page) {
  return page.getByRole('button', { name: /reject all|reject the use|odrzuć wszystko/i }).first();
}
export async function installConsentHandler(page: Page): Promise<void> {
  await page.addLocatorHandler(consentButton(page), () => dismissConsent(page));
}
export async function dismissConsent(page: Page): Promise<void> {
  const reject = consentButton(page);
  if (await reject.isVisible()) {
    await reject.click();
    await page.locator('ytd-consent-bump-v2-lightbox').waitFor({ state: 'hidden', timeout: 10000 });
  }
}
export async function openYoutube(page: Page, spec: VideoSpec): Promise<void> {
  await page.goto(spec.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('#movie_player', { timeout: 30000 });
  await page.waitForSelector('ytd-app', { timeout: 15000 });
  await page.evaluate(() => {
    const app = document.querySelector<YoutubeApp>('ytd-app');
    if (app?.getCurrentTheme?.() !== 'USER_INTERFACE_THEME_DARK') app?.handleSignalActionToggleDarkThemeOn?.();
  });
  await page.waitForFunction(() => document.querySelector<YoutubeApp>('ytd-app')?.getCurrentTheme?.() === 'USER_INTERFACE_THEME_DARK', null, { timeout: 15000 });
  await alignVideo(page, spec);
  if (spec.fps != null && (await readPlayer(page)).streamFps !== spec.fps) {
    throw new Error(`stream-fps-unavailable: requires ${spec.fps} fps`);
  }
}
export async function alignVideo(page: Page, spec: VideoSpec): Promise<void> {
  await page.bringToFront();
  await waitFor(async () => {
    const ready = await page.evaluate(spec => {
      const movie = document.querySelector<YoutubePlayer>('#movie_player'), video = document.querySelector<HTMLVideoElement>('video.html5-main-video');
      if (!movie || !video || document.querySelector('.ad-showing')) return false;
      const data = movie.getVideoData?.();
      if (!data || typeof data !== 'object' || !('video_id' in data) || data.video_id !== spec.id) return false;
      movie.unMute?.(); movie.setVolume?.(100); video.muted = false; video.volume = 1; video.playbackRate = 1;
      const levels = movie.getAvailableQualityLevels?.();
      if (movie.getPlaybackQuality?.() !== spec.quality) {
        if (Array.isArray(levels) && !levels.includes(spec.quality)) throw new Error(`Unavailable quality: ${spec.quality}`);
        movie.setPlaybackQualityRange?.(spec.quality, spec.quality); movie.setPlaybackQuality?.(spec.quality);
      }
      if (Math.abs(video.currentTime - spec.startSec) > 2) movie.seekTo?.(spec.startSec, true);
      if (video.paused) movie.playVideo?.();
      return !video.paused && video.readyState >= 3 && movie.getPlaybackQuality?.() === spec.quality
        && video.videoWidth === spec.width && video.videoHeight === spec.height && Math.abs(video.currentTime - spec.startSec) <= 2;
    }, spec);
    return ready;
  }, 35000);
}
export async function openSettings(page: Page): Promise<void> {
  await page.locator('#movie_player').hover({ timeout: 10000 });
  const menu = page.locator('.ytp-settings-menu');
  // aria-expanded is the toggle state; geometry can still be hidden while opening.
  const button = page.locator('.ytp-settings-button');
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  await menu.waitFor({ state: 'visible', timeout: 5000 });
}
async function setCheckbox(page: Page, names: string[], want: boolean): Promise<void> {
  await openSettings(page);
  const item = page.locator('.ytp-menuitem').filter({ hasText: new RegExp(names.join('|'), 'i') }).first();
  if (await item.count() === 0) throw new Error(`native-unavailable: ${names[0]}`);
  const value = await item.getAttribute('aria-checked');
  if (value !== 'true' && value !== 'false') throw new Error(`native-unavailable: ${names[0]} checkbox`);
  if ((value === 'true') !== want) await item.click();
  await page.keyboard.press('Escape');
  await page.locator('.ytp-settings-menu').waitFor({ state: 'hidden', timeout: 5000 });
}
export async function applyNative(page: Page, state: State): Promise<void> {
  await setCheckbox(page, ['voice boost', 'wzmocnienie głosu'], false);
  await setCheckbox(page, ['stable volume', 'stabilna głośność'], state.native.stable);
  await setCheckbox(page, ['ambient mode', 'oświetlenie kinowe', 'tryb otoczenia'], state.native.cinematic);
  if (state.native.voice) await setCheckbox(page, ['voice boost', 'wzmocnienie głosu'], true);
}
async function setSettings(session: Session, state: State): Promise<void> {
  if (!session.worker) throw new Error('Extension worker unavailable');
  await session.worker.evaluate(async value => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set(value);
  }, { voiceBoost: state.audio.voice, volumeLeveling: state.audio.leveling, bassLevel: state.audio.bass,
    volumeBoostEnabled: state.boost > 1, youtubeIntegrationEnabled: state.rte, autoTheaterEnabled: false });
  await session.page.waitForFunction(rte => document.documentElement.hasAttribute('data-te-youtube-integration-off') !== rte, state.rte);
}
export async function toggleTheater(page: Page, want: boolean): Promise<void> {
  if ((await readPlayer(page)).theater !== want) {
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await page.keyboard.press('t');
    await page.waitForFunction(want => document.documentElement.classList.contains('theater-everywhere-html-active') === want, want, { timeout: 8000 });
  }
}
export async function navigateSpa(page: Page, target: VideoSpec): Promise<void> {
  const documentId = await page.evaluate(() => window.__cpuSuiteProbe?.documentId);
  await page.evaluate(id => {
    document.querySelector('ytd-app')?.dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, cancelable: true,
      detail: { endpoint: { commandMetadata: { webCommandMetadata: { url: `/watch?v=${id}`, webPageType: 'WEB_PAGE_TYPE_WATCH' } },
        watchEndpoint: { videoId: id } } } }));
  }, target.id);
  await page.waitForFunction(id => new URL(location.href).searchParams.get('v') === id, target.id, { timeout: 15000 });
  if (!documentId || await page.evaluate(() => window.__cpuSuiteProbe?.documentId) !== documentId) throw new Error('SPA navigation reloaded the document');
  await alignVideo(page, target);
}
export async function prepareScenario(session: Session, scenario: Scenario): Promise<void> {
  const state = scenario.expected;
  await openYoutube(session.page, scenario.video);
  await applyNative(session.page, state);
  // Native audio toggles can replace YouTube's MediaSource. Reload before
  // activating theater so the measured fragment belongs to one fresh stream.
  // The final state check verifies that host preferences survived this reload.
  await openYoutube(session.page, scenario.video);
  await openSettings(session.page);
  await session.page.keyboard.press('Escape');
  if (!state.extension) {
    await alignVideo(session.page, scenario.target);
    await seekFragment(session.page, scenario.target, false);
    await waitForScenario(session.page, scenario);
    return;
  }
  const activate: State = state.transition !== 'none' ? { ...state, theater: true, rte: true, audio: activeAudio, boost: 1, paused: false, bar: 'any' } : state;
  await setSettings(session, activate);
  if (state.transition === 'exit') await session.page.evaluate(() => {
    window.__cpuSuiteProbe!.restoration = ['#movie_player', 'ytd-watch-flexy', 'video.html5-main-video'].flatMap(selector => {
      const element = document.querySelector(selector); return element ? [{ element, style: element.getAttribute('style') }] : [];
    });
  });
  await toggleTheater(session.page, activate.theater);
  if (activate.boost > 1) {
    await waitFor(async () => {
      if ((await readPlayer(session.page)).video?.boost === activate.boost) return true;
      await session.page.keyboard.press('ArrowUp'); return false;
    }, 8000);
  }
  if (!isNeutralAudio(activate.audio) || activate.boost > 1) {
    await session.page.keyboard.press('ArrowRight'); // trusted gesture activates the shared audio graph
    await waitFor(async () => {
      const snapshot = await readPlayer(session.page);
      return snapshot.video?.graphReady === true && snapshot.video.graph?.state === 'running' && snapshot.video.audio != null
        && snapshot.video.audio.voice === activate.audio.voice && snapshot.video.audio.leveling === activate.audio.leveling && snapshot.video.audio.bass === activate.audio.bass;
    }, 8000);
  }
  if (state.transition !== 'none') {
    await waitFor(async () => checkState(activate, await readPlayer(session.page)) === null, 8000);
    if (state.transition === 'neutralize') await setSettings(session, state);
    if (state.transition === 'exit') {
      await toggleTheater(session.page, false);
      await waitFor(() => session.page.evaluate(() => window.__cpuSuiteProbe!.restoration!.every(({ element, style }) => element.isConnected && element.getAttribute('style') === style)), 8000);
    }
    if (state.transition === 'navigate') {
      await navigateSpa(session.page, scenario.target);
      await toggleTheater(session.page, true);
      await session.page.keyboard.press('ArrowRight');
    }
  }
  // Reset position after setup so every build measures the same fragment. This
  // also prevents UI preparation time from shifting the A/B video workload.
  await alignVideo(session.page, scenario.target);
  if (state.paused) {
    await session.page.keyboard.press('Space');
    await session.page.waitForFunction(() => document.querySelector<HTMLVideoElement>('video.html5-main-video')?.paused);
  }
  if (state.bar === 'focused') {
    await session.page.locator('.theater-volume-slider').waitFor();
    await waitFor(async () => {
      const p = await readPlayer(session.page);
      if (p.sliderFocused && p.sliderFocusVisible) return true;
      await session.page.keyboard.press('Tab'); return false;
    }, 8000);
  } else {
    await session.page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await session.page.mouse.move(720, 280);
  }
  await seekFragment(session.page, scenario.target, state.paused);
  await waitForScenario(session.page, scenario);
}

async function waitForScenario(page: Page, scenario: Scenario): Promise<void> {
  const readiness: { mismatch: ReturnType<typeof checkPlayer> } = { mismatch: null };
  try {
    await waitFor(async () => { readiness.mismatch = checkPlayer(scenario, await readPlayer(page)); return readiness.mismatch === null; }, 10000);
  } catch {
    throw new Error(`${readiness.mismatch?.code ?? 'state-unavailable'}: ${readiness.mismatch?.detail ?? 'scenario readiness timeout'}`);
  }
}

export async function seekFragment(page: Page, spec: VideoSpec, paused: boolean): Promise<void> {
  await page.evaluate(time => {
    const player = document.querySelector<YoutubePlayer>('#movie_player');
    if (!player?.seekTo) throw new Error('native-api-unavailable: seekTo');
    player.seekTo(time, true);
  }, spec.startSec);
  await waitFor(async () => {
    const snapshot = await readPlayer(page), video = snapshot.video;
    return snapshot.videoId === spec.id && video != null && video.readyState >= 3 && video.paused === paused
      && Math.abs(video.currentTime - spec.startSec) <= 0.4;
  }, 15000);
}
