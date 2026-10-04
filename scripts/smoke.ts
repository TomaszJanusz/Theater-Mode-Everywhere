import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, firefox, type BrowserContext, type Page } from 'playwright';

type SmokeBrowser = 'chromium' | 'firefox';

const ROOT = path.resolve(__dirname, '..');
const PLAYER_FIXTURE = path.join(ROOT, 'test/fixtures/local-player.html');
const IFRAME_FIXTURE = path.join(ROOT, 'test/fixtures/iframe-player.html');
const YOUTUBE_EMBED_FIXTURE = path.join(ROOT, 'test/fixtures/youtube-embed.html');
const THEATER_VIDEO_CLASS = 'theater-everywhere-video-active';
const THEATER_HTML_CLASS = 'theater-everywhere-html-active';
const PARENT_HOST = 'child.example.localhost';
const PARENT_BLACKLIST = 'example.localhost';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function skipLocally(message: string): never {
  if (process.env.CI) fail(message);
  console.warn(message);
  process.exit(0);
}

function requestedBrowsers(): SmokeBrowser[] {
  const arg = process.argv[2];
  if (!arg) return ['chromium', 'firefox'];
  if (arg === 'chromium' || arg === 'firefox') return [arg];
  fail(`Unknown smoke target "${arg}". Use chromium, firefox, or omit for both.`);
}

function playwrightExecutable(kind: SmokeBrowser): string | null {
  try {
    const exe = kind === 'chromium' ? chromium.executablePath() : firefox.executablePath();
    return existsSync(exe) ? exe : null;
  } catch {
    return null;
  }
}

function requireBuiltExtension(kind: SmokeBrowser): string {
  const dir = path.join(ROOT, 'dist', kind === 'chromium' ? 'chrome-unpacked' : 'firefox-unpacked');
  const contentJs = path.join(dir, 'content.js');
  const contentCss = path.join(dir, 'content.css');
  if (!existsSync(contentJs) || !existsSync(contentCss)) {
    fail(`Missing ${dir}. Run pnpm build before smoke tests.`);
  }
  return dir;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startFixtureServer(): Promise<{ origin: string; close: () => Promise<void> }> {
  const player = readFileSync(PLAYER_FIXTURE);
  const iframe = readFileSync(IFRAME_FIXTURE);
  const youtubeEmbed = readFileSync(YOUTUBE_EMBED_FIXTURE);
  const server = createServer((req, res) => {
    const url = req.url || '/';
    const body = url.startsWith('/youtube-embed')
      ? youtubeEmbed
      : url.startsWith('/iframe')
        ? iframe
        : player;
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    });
    res.end(body);
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done, failClose) => {
          server.close((err) => (err ? failClose(err) : done()));
        })
      });
    });
    server.on('error', reject);
  });
}

async function waitForPlayer(page: Page): Promise<void> {
  await page.waitForSelector('video#player', { timeout: 15_000 });
  await page.waitForFunction(() => {
    const video = document.querySelector('video#player') as HTMLVideoElement | null;
    if (!video) return false;
    const box = video.getBoundingClientRect();
    return box.width >= 80 && box.height >= 80;
  }, null, { timeout: 15_000 });
}

async function theaterEntered(page: Page): Promise<boolean> {
  return page.evaluate(({ videoClass, htmlClass }) => {
    const video = document.querySelector('video#player');
    return Boolean(video?.classList.contains(videoClass) || document.documentElement.classList.contains(htmlClass));
  }, { videoClass: THEATER_VIDEO_CLASS, htmlClass: THEATER_HTML_CLASS });
}

async function assertTheaterToggle(page: Page): Promise<void> {
  await page.click('video#player');
  await page.keyboard.press('t');
  await page.waitForFunction(({ videoClass, htmlClass }) => {
    const video = document.querySelector('video#player');
    return Boolean(video?.classList.contains(videoClass) || document.documentElement.classList.contains(htmlClass));
  }, { videoClass: THEATER_VIDEO_CLASS, htmlClass: THEATER_HTML_CLASS }, { timeout: 10_000 });

  if (!await theaterEntered(page)) fail('Theater mode did not activate after T.');

  const pausedBefore = await page.evaluate(() => {
    const video = document.querySelector('video#player') as HTMLVideoElement | null;
    return Boolean(video?.paused);
  });
  await page.keyboard.press('Space');
  await delay(400);
  const pausedAfter = await page.evaluate(() => {
    const video = document.querySelector('video#player') as HTMLVideoElement | null;
    return Boolean(video?.paused);
  });
  if (pausedAfter === pausedBefore) {
    const diagnostics = await page.locator('video#player').evaluate((video: HTMLVideoElement) => ({ paused: video.paused, time: video.currentTime, ready: video.readyState, source: Boolean(video.srcObject), error: video.error?.message }));
    fail(`Space did not toggle playback (before=${pausedBefore}, after=${pausedAfter}): ${JSON.stringify(diagnostics)}`);
  }
  if (!pausedAfter) {
    await page.keyboard.press('Space');
    await delay(200);
  }

  await page.keyboard.press('Escape');
  await page.waitForFunction(({ videoClass, htmlClass }) => {
    const video = document.querySelector('video#player');
    return !video?.classList.contains(videoClass) && !document.documentElement.classList.contains(htmlClass);
  }, { videoClass: THEATER_VIDEO_CLASS, htmlClass: THEATER_HTML_CLASS }, { timeout: 10_000 });
}

async function assertControlsPin(page: Page, context?: BrowserContext): Promise<void> {
  const pin = page.locator('.controls-pin-btn');
  const controls = page.locator('.theater-controls-wrapper');
  const waitForChrome = async (pinned: boolean, visible: boolean, headerVisible: boolean) => {
    await page.waitForFunction(({ pinned, visible, headerVisible }) => {
      const root = document.getElementById('theater-everywhere-ui')?.shadowRoot;
      const bar = root?.querySelector('.theater-controls-wrapper');
      const button = root?.querySelector('.controls-pin-btn');
      const header = root?.querySelector('.theater-everywhere-header-hud');
      return Boolean(bar && button && header
        && button.getAttribute('aria-pressed') === String(pinned)
        && bar.classList.contains('visible') === visible
        && header.classList.contains('visible') === headerVisible
        && (header as HTMLElement).inert === !headerVisible);
    }, { pinned, visible, headerVisible });
  };

  await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.play());
  await page.locator('video#player').evaluate((video: HTMLVideoElement) => {
    const track = video.addTextTrack('subtitles', 'Smoke captions', 'en');
    track.addCue(new VTTCue(0, 3600, 'Pinned controls keep captions clear'));
    track.mode = 'hidden';
  });
  await page.locator('video#player').click();
  await page.keyboard.press('t');
  await page.keyboard.press('c');
  await page.locator('.theater-caption-overlay.visible').waitFor();
  await page.mouse.move(640, 300);
  await waitForChrome(false, true, true);
  await waitForChrome(false, false, false);

  // Pin an already hidden bar, suppress repeats, and keep the header idle.
  await page.keyboard.down('Shift');
  await page.keyboard.down('h');
  await pin.waitFor();
  await page.keyboard.down('h');
  await page.keyboard.up('h');
  await page.keyboard.up('Shift');
  await waitForChrome(true, true, false);
  const timeBefore = await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.currentTime);
  await delay(2800);
  await waitForChrome(true, true, false);
  const timeAfter = await page.locator('video#player').evaluate((video: HTMLVideoElement) => video.currentTime);
  if (process.env.THEATER_SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT });
  if (timeAfter <= timeBefore) fail('Playback stopped while controls were pinned.');
  const idle = await page.evaluate(() => {
    const root = document.getElementById('theater-everywhere-ui')?.shadowRoot;
    const header = root?.querySelector('.theater-everywhere-header-hud');
    const home = root?.querySelector('.theater-home-pill');
    return {
      cursorHidden: document.documentElement.classList.contains('theater-everywhere-cursor-hidden'),
      headerOpacity: header ? getComputedStyle(header).opacity : null,
      homePointerEvents: home ? getComputedStyle(home).pointerEvents : null,
      captionsLifted: document.querySelector('video#player')?.classList.contains('controls-visible'),
      captionBottom: parseFloat(document.documentElement.style.getPropertyValue('--theater-caption-bottom'))
    };
  });
  if (!idle.cursorHidden || idle.headerOpacity !== '0' || idle.homePointerEvents !== 'none'
      || !idle.captionsLifted || !(idle.captionBottom > 48)) {
    fail(`Pinned idle chrome or caption clearance is incorrect: ${JSON.stringify(idle)}`);
  }

  // Editable fields must not consume the shortcut.
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'pin-test-input';
    document.body.appendChild(input);
    input.focus();
  });
  await page.keyboard.press('Shift+H');
  if (await pin.getAttribute('aria-pressed') !== 'true') fail('Pin shortcut fired in an input.');
  await page.evaluate(() => document.getElementById('pin-test-input')?.remove());

  // Keyboard focus keeps Home reachable, and hovering the bar keeps the cursor usable.
  await pin.focus();
  await page.keyboard.press('Tab');
  await waitForChrome(true, true, true);
  await delay(2800);
  await waitForChrome(true, true, true);
  await page.evaluate(() => (document.getElementById('theater-everywhere-ui')?.shadowRoot?.activeElement as HTMLElement | null)?.blur());
  await pin.hover();
  await delay(2800);
  const cursorHiddenOverControls = await page.evaluate(() =>
    document.documentElement.classList.contains('theater-everywhere-cursor-hidden'));
  if (cursorHiddenOverControls || await pin.evaluate((el) => getComputedStyle(el).cursor) === 'none') {
    fail('Cursor is hidden over a pinned control.');
  }
  await page.mouse.move(640, 300);
  await waitForChrome(true, true, false);

  // Idle header changes must not dismiss the menu on the pinned playback bar.
  await page.locator('.cc-btn').click();
  await page.mouse.move(640, 300);
  await waitForChrome(true, true, false);
  if (!await page.locator('.theater-cc-menu.visible').count()) fail('Idle chrome dismissed the pinned captions menu.');
  await page.locator('.cc-btn').click();
  await page.mouse.move(640, 300);

  await page.keyboard.press('f');
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await waitForChrome(true, true, false);
  await page.keyboard.press('f');
  await page.waitForFunction(() => !document.fullscreenElement);

  // Rebuild the UI, retaining the saved/local preference.
  await page.keyboard.press('Escape');
  await controls.waitFor({ state: 'detached' });
  await page.keyboard.press('t');
  await waitForChrome(true, true, true);
  await waitForChrome(true, true, false);

  if (context) {
    // Actual extension storage, reload, and the settings page share the same preference.
    const worker = await extensionWorker(context);
    const saved = await worker.evaluate(async () => (await chrome.storage.sync.get('keepControlsVisible')).keepControlsVisible);
    if (saved !== true) fail('Pin preference was not persisted.');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await page.locator('video#player').click();
    await page.keyboard.press('t');
    await waitForChrome(true, true, true);
    await waitForChrome(true, true, false);
    const options = await context.newPage();
    try {
      await options.goto(new URL('options/options.html', worker.url()).href);
      await options.locator('.te-dialog-btn-primary').click();
      const toggle = options.locator('#keep-controls-visible-toggle');
      await toggle.waitFor({ state: 'attached' });
      await options.waitForFunction(() => (document.getElementById('keep-controls-visible-toggle') as HTMLInputElement)?.checked);
      await options.locator('label.toggle-switch').filter({ has: toggle }).click();
      await waitForChrome(false, true, true);
      await waitForChrome(false, false, false);
      await page.keyboard.press('Shift+H');
      await options.waitForFunction(() => (document.getElementById('keep-controls-visible-toggle') as HTMLInputElement)?.checked);
      await waitForChrome(true, true, false);
      await options.locator('#shortcut-controls-pin').press('Shift+U');
      await options.waitForFunction(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts?.toggleControlsPin === 'Shift+U');
      await options.locator('#shortcut-toggle-mute').press('Control+M');
      await options.waitForFunction(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts?.toggleMute === 'Ctrl+M');
      await options.waitForFunction(() => (document.getElementById('shortcut-controls-pin') as HTMLInputElement)?.value === 'Shift+U');
      const shortcuts = await worker.evaluate(async () => (await chrome.storage.sync.get('shortcuts')).shortcuts);
      if (shortcuts.toggleControlsPin !== 'Shift+U' || shortcuts.toggleMute !== 'Ctrl+M') {
        fail('Editing another shortcut lost the custom pin shortcut.');
      }
      await page.keyboard.press('Shift+U');
      await waitForChrome(false, true, true);
      await worker.evaluate(async () => { await chrome.storage.sync.remove('shortcuts'); });
      // Existing shortcut-removal behavior does not reset the live runtime: reload below.
    } finally {
      await options.close();
    }
  } else {
    await page.keyboard.press('Shift+H');
    await waitForChrome(false, true, true);
  }
  await waitForChrome(false, false, false);
  await page.keyboard.press('Escape');
  await controls.waitFor({ state: 'detached' });
  if (await page.evaluate(() => document.documentElement.classList.contains('theater-everywhere-cursor-hidden'))) {
    fail('Exiting theater mode left the cursor hidden.');
  }
  console.log(`smoke controls pin: idle, playback, repeat, input, focus, hover, captions, popovers, fullscreen and rebuild${context ? ', persistence and settings' : ''} passed`);
}

async function injectBundledPlayer(page: Page, unpackedDir: string): Promise<void> {
  const cssPath = path.join(unpackedDir, 'content.css');
  await page.addStyleTag({ path: cssPath });
  for (const filename of ['mainWorld.js', 'content.js']) {
    const source = readFileSync(path.join(unpackedDir, filename), 'utf8');
    const isModule = /^\s*export\b/m.test(source) || /^\s*import\b/m.test(source);
    // Content scripts have their own global scope; preserve it in the injected fallback.
    await page.addScriptTag({ content: isModule ? source : `(() => {\n${source}\n})();`, type: isModule ? 'module' : undefined });
  }
  await delay(400);
}

async function extensionWorker(context: BrowserContext) {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  return worker;
}

async function setBlacklist(context: BrowserContext, entries: string[]): Promise<void> {
  const worker = await extensionWorker(context);
  await worker.evaluate(async (blacklist) => {
    await chrome.storage.sync.set({ blacklist });
  }, entries);
}

async function assertBlacklistBlocksTheater(page: Page): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForPlayer(page);
  await page.click('video#player');
  await page.keyboard.press('t');
  await delay(800);
  if (await theaterEntered(page)) {
    fail('Theater mode activated on a blacklisted host.');
  }
}

async function assertIframeHandshake(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/iframe`, { waitUntil: 'domcontentloaded' });
  const frame = page.frameLocator('#child');
  await frame.locator('video#player').click({ timeout: 15_000 });
  await page.keyboard.press('t');
  await page.waitForFunction((videoClass) => {
    const iframe = document.querySelector('#child');
    const childDoc = (iframe as HTMLIFrameElement | null)?.contentDocument;
    const childVideo = childDoc?.querySelector('video#player');
    return Boolean(
      iframe?.classList.contains(videoClass)
      || childVideo?.classList.contains(videoClass)
      || childDoc?.documentElement.classList.contains('theater-everywhere-html-active')
    );
  }, THEATER_VIDEO_CLASS, { timeout: 10_000 });
  // A shortcut focused in the parent must update the child player exactly once.
  await page.locator('body').press('Shift+H');
  await frame.locator('.controls-pin-btn[aria-pressed="true"]').waitFor();
  await frame.locator('body').press('Shift+H');
  await frame.locator('.controls-pin-btn[aria-pressed="false"]').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction((videoClass) => {
    const iframe = document.querySelector('#child');
    const childDoc = (iframe as HTMLIFrameElement | null)?.contentDocument;
    const childVideo = childDoc?.querySelector('video#player');
    return !iframe?.classList.contains(videoClass)
      && !childVideo?.classList.contains(videoClass)
      && !childDoc?.documentElement.classList.contains('theater-everywhere-html-active');
  }, THEATER_VIDEO_CLASS, { timeout: 10_000 });

  await delay(400);
  await frame.locator('video#player').click({ timeout: 15_000 });
  await delay(200);
  await frame.locator('body').press('t');
  await page.waitForFunction((videoClass) => {
    const iframe = document.querySelector('#child');
    const childDoc = (iframe as HTMLIFrameElement | null)?.contentDocument;
    const childVideo = childDoc?.querySelector('video#player');
    return Boolean(
      iframe?.classList.contains(videoClass)
      || childVideo?.classList.contains(videoClass)
      || childDoc?.documentElement.classList.contains('theater-everywhere-html-active')
    );
  }, THEATER_VIDEO_CLASS, { timeout: 10_000 });
  await delay(400);
  await frame.locator('body').press('Escape');
  await page.waitForFunction((videoClass) => {
    const iframe = document.querySelector('#child');
    const childDoc = (iframe as HTMLIFrameElement | null)?.contentDocument;
    const childVideo = childDoc?.querySelector('video#player');
    return !iframe?.classList.contains(videoClass)
      && !childVideo?.classList.contains(videoClass)
      && !childDoc?.documentElement.classList.contains('theater-everywhere-html-active');
  }, THEATER_VIDEO_CLASS, { timeout: 10_000 });
  console.log('smoke:chromium iframe child T/Escape passed');
}

async function assertParentBlacklist(page: Page, origin: string, context: BrowserContext): Promise<void> {
  await setBlacklist(context, [PARENT_BLACKLIST]);
  const port = new URL(origin).port;
  await page.goto(`http://${PARENT_HOST}:${port}/`, { waitUntil: 'domcontentloaded' });
  await waitForPlayer(page);
  await page.click('video#player');
  await page.keyboard.press('t');
  await delay(800);
  if (await theaterEntered(page)) {
    fail('Theater mode activated under a parent-domain blacklist.');
  }
}

async function smokeChromium(origin: string, unpackedDir: string): Promise<void> {
  if (!playwrightExecutable('chromium')) {
    skipLocally('Skipping smoke:chromium. Run: pnpm exec playwright install chromium firefox');
  }

  const userDataDir = mkdtempSync(path.join(tmpdir(), 'te-smoke-chromium-'));
  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      viewport: { width: 1280, height: 720 },
      args: [
        '--headless=new',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        `--host-resolver-rules=MAP *.example.localhost 127.0.0.1,MAP example.localhost 127.0.0.1`,
        `--disable-extensions-except=${unpackedDir}`,
        `--load-extension=${unpackedDir}`
      ]
    });

    const page = context.pages()[0] || await context.newPage();
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await assertTheaterToggle(page);
    console.log('smoke:chromium local player T/Escape passed');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await assertControlsPin(page, context);

    await setBlacklist(context, ['127.0.0.1']);
    await assertBlacklistBlocksTheater(page);
    await setBlacklist(context, []);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await assertTheaterToggle(page);
    console.log('smoke:chromium blacklist exact host passed');

    await assertIframeHandshake(page, origin);
    console.log('smoke:chromium same-origin iframe handshake passed');

    await assertParentBlacklist(page, origin, context);
    await setBlacklist(context, []);
    console.log('smoke:chromium parent-domain blacklist passed');
  } finally {
    await context?.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function tryFirefoxSideload(origin: string): Promise<boolean> {
  const xpiSource = path.join(ROOT, 'dist/theater-everywhere-firefox.zip');
  if (!existsSync(xpiSource)) return false;
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'te-smoke-firefox-'));
  const extensionsDir = path.join(userDataDir, 'extensions');
  mkdirSync(extensionsDir, { recursive: true });
  copyFileSync(xpiSource, path.join(extensionsDir, 'theater-everywhere@tomaszjanusz.dev.xpi'));
  let context: BrowserContext | null = null;
  let sideloadVerified = false;
  try {
    context = await firefox.launchPersistentContext(userDataDir, {
      headless: true,
      viewport: { width: 1280, height: 720 },
      firefoxUserPrefs: {
        'xpinstall.signatures.required': false,
        'extensions.autoDisableScopes': 0,
        'extensions.enabledScopes': 15,
        'extensions.startupScanScopes': 15
      }
    });
    const page = context.pages()[0] || await context.newPage();
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await page.click('video#player');
    await page.keyboard.press('t');
    await delay(1500);
    const entered = await theaterEntered(page);
    if (!entered) return false;
    sideloadVerified = true;
    await page.keyboard.press('Escape');
    await delay(500);
    await assertControlsPin(page);
    console.log('smoke:firefox passed (sideloaded MV3 xpi)');
    return true;
  } catch (error) {
    if (sideloadVerified) throw error;
    return false;
  } finally {
    await context?.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function smokeFirefox(origin: string, unpackedDir: string): Promise<void> {
  if (!playwrightExecutable('firefox')) {
    skipLocally('Skipping smoke:firefox. Run: pnpm exec playwright install chromium firefox');
  }

  if (await tryFirefoxSideload(origin)) return;

  // Playwright cannot sideload an unsigned MV3 Firefox addon. Chromium smoke
  // covers the packaged extension; this path only checks the bundled player
  // script as a local/CI diagnostic, not Firefox permissions or background.

  const browser = await firefox.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (error) => console.warn('Firefox page error:', error.message));
    page.on('console', (message) => { if (message.type() === 'error') console.warn('Firefox console:', message.text()); });
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await injectBundledPlayer(page, unpackedDir);
    await assertTheaterToggle(page);
    await assertControlsPin(page);
    console.log('smoke:firefox passed (injected bundled mainWorld.js and content.js; sideload of unsigned MV3 xpi is blocked)');
  } finally {
    await browser.close();
  }
}

async function run(): Promise<void> {
  if (!existsSync(PLAYER_FIXTURE) || !existsSync(IFRAME_FIXTURE) || !existsSync(YOUTUBE_EMBED_FIXTURE)) {
    fail('Missing smoke fixtures under test/fixtures.');
  }

  const targets = requestedBrowsers();
  const fixture = await startFixtureServer();
  try {
    for (const kind of targets) {
      const unpackedDir = requireBuiltExtension(kind);
      if (kind === 'chromium') await smokeChromium(fixture.origin, unpackedDir);
      else await smokeFirefox(fixture.origin, unpackedDir);
    }
  } finally {
    await fixture.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
