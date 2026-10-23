import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, firefox, type BrowserContext, type Page } from 'playwright';

export type SmokeBrowser = 'chromium' | 'firefox';

export const ROOT = path.resolve(__dirname, '../..');
export const PLAYER_FIXTURE = path.join(ROOT, 'test/fixtures/local-player.html');
export const IFRAME_FIXTURE = path.join(ROOT, 'test/fixtures/iframe-player.html');
export const IFRAME_KEY_CAPTURE_FIXTURE = path.join(ROOT, 'test/fixtures/iframe-key-capture.html');
export const YOUTUBE_EMBED_FIXTURE = path.join(ROOT, 'test/fixtures/youtube-embed.html');
// Two seconds of neutral 160x90 VP8 frames, with real finite-duration WebM metadata.
export const VOD_FIXTURE = path.join(ROOT, 'test/fixtures/vod.webm');
export const THEATER_VIDEO_CLASS = 'theater-everywhere-video-active';
export const THEATER_HTML_CLASS = 'theater-everywhere-html-active';
export const PARENT_HOST = 'child.example.localhost';
export const PARENT_BLACKLIST = 'example.localhost';


export function fail(message: string): never {
  throw new Error(message);
}

export function skipLocally(message: string): never {
  if (process.env.CI) fail(message);
  console.warn(message);
  process.exit(0);
}

export function requestedBrowsers(): SmokeBrowser[] {
  const arg = process.argv[2];
  if (!arg) return ['chromium', 'firefox'];
  if (arg === 'chromium' || arg === 'firefox') return [arg];
  fail(`Unknown smoke target "${arg}". Use chromium, firefox, or omit for both.`);
}

export function playwrightExecutable(kind: SmokeBrowser): string | null {
  try {
    const exe = kind === 'chromium' ? chromium.executablePath() : firefox.executablePath();
    return existsSync(exe) ? exe : null;
  } catch {
    return null;
  }
}

export function requireBuiltExtension(kind: SmokeBrowser): string {
  const dir = path.join(ROOT, 'dist', kind === 'chromium' ? 'chrome-unpacked' : 'firefox-unpacked');
  const contentJs = path.join(dir, 'content.js');
  const contentCss = path.join(dir, 'content.css');
  if (!existsSync(contentJs) || !existsSync(contentCss)) {
    fail(`Missing ${dir}. Run pnpm build before smoke tests.`);
  }
  return dir;
}

export function startFixtureServer(): Promise<{ origin: string; close: () => Promise<void> }> {
  const player = readFileSync(PLAYER_FIXTURE);
  const iframe = readFileSync(IFRAME_FIXTURE);
  const iframeKeyCapture = readFileSync(IFRAME_KEY_CAPTURE_FIXTURE);
  const youtubeEmbed = readFileSync(YOUTUBE_EMBED_FIXTURE);
  const vod = readFileSync(VOD_FIXTURE);
  const server = createServer((req, res) => {
    const url = req.url || '/';
    if (url.startsWith('/vod.webm')) {
      res.writeHead(200, { 'content-type': 'video/webm', 'content-length': vod.length, 'cache-control': 'no-store' });
      res.end(vod);
      return;
    }
    const body = url.startsWith('/youtube-embed')
      ? youtubeEmbed
      : url.startsWith('/iframe-key-capture')
        ? iframeKeyCapture
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

export async function waitForPlayer(page: Page): Promise<void> {
  await page.waitForSelector('video#player', { timeout: 15_000 }).catch(async error => {
    console.error('Player fixture readiness:', await page.evaluate(() => {
      const video = document.querySelector('video#player');
      const rect = video?.getBoundingClientRect();
      const style = video ? getComputedStyle(video) : null;
      return { url: location.href, ready: document.readyState, title: document.title,
        videoCount: document.querySelectorAll('video').length,
        rect: rect?.toJSON(), display: style?.display, visibility: style?.visibility };
    }));
    if (process.env.THEATER_SMOKE_SCREENSHOT) {
      await page.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT.replace(/\.png$/, '-player-missing.png') });
    }
    throw error;
  });
  await page.waitForFunction(() => {
    const video = document.querySelector('video#player') as HTMLVideoElement | null;
    if (!video) return false;
    const box = video.getBoundingClientRect();
    return box.width >= 80 && box.height >= 80;
  }, null, { timeout: 15_000 });
}

export async function theaterEntered(page: Page): Promise<boolean> {
  return page.evaluate(({ videoClass, htmlClass }) => {
    const video = document.querySelector('video#player');
    return Boolean(video?.classList.contains(videoClass) || document.documentElement.classList.contains(htmlClass));
  }, { videoClass: THEATER_VIDEO_CLASS, htmlClass: THEATER_HTML_CLASS });
}

export async function injectBundledPlayer(page: Page, unpackedDir: string): Promise<void> {
  const cssPath = path.join(unpackedDir, 'content.css');
  await page.addStyleTag({ path: cssPath });
  for (const filename of ['mainWorld.js', 'content.js']) {
    const source = readFileSync(path.join(unpackedDir, filename), 'utf8');
    const isModule = /^\s*export\b/m.test(source) || /^\s*import\b/m.test(source);
    // Content scripts have their own global scope; preserve it in the injected fallback.
    await page.addScriptTag({ content: isModule ? source : `(() => {\n${source}\n})();`, type: isModule ? 'module' : undefined });
  }
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
}

/** The installed extension's background context: a Chromium service worker, or Firefox's event page over RDP. */
export interface ExtensionBackground {
  /** A URL inside the extension, the base for its pages. */
  url(): string;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
}

const firefoxBackgrounds = new WeakMap<BrowserContext, ExtensionBackground>();

/** Playwright cannot attach to Firefox extension contexts, so the Firefox smoke registers its own. */
export function setFirefoxBackground(context: BrowserContext, background: ExtensionBackground): void {
  firefoxBackgrounds.set(context, background);
}

export async function extensionWorker(context: BrowserContext): Promise<ExtensionBackground> {
  const firefoxBackground = firefoxBackgrounds.get(context);
  if (firefoxBackground) return firefoxBackground;
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
  return worker;
}

export async function setBlacklist(context: BrowserContext, entries: string[]): Promise<void> {
  const worker = await extensionWorker(context);
  await worker.evaluate(async (blacklist) => {
    await chrome.storage.sync.set({ blacklist });
  }, entries);
}

export async function declineVideoActivatorPrompt(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  const decline = dialog.locator('.te-dialog-btn-secondary');
  if (!await decline.evaluate(button => button.matches(':focus'))) {
    fail('The Video launcher offer must initially focus No.');
  }
  await decline.press('Enter');
  await dialog.waitFor({ state: 'detached' });
  // Moving focus into the modal can dismiss the settings popover.
  if (!await page.locator('.theater-settings-menu').isVisible()) {
    await page.locator('.player-settings-btn').press('Enter');
  }
  await page.locator('.auto-theater-btn').focus();
}

/** Inclusive scenario durations; nested rows must not be summed with their parent. */
export async function timeScenario(name: string, action: () => Promise<void>): Promise<void> {
  const start = performance.now();
  try { await action(); }
  finally {
    if (process.env.THEATER_SMOKE_TIMING === '1') {
      console.log(`TIMING ${name} ${((performance.now() - start) / 1000).toFixed(3)}`);
    }
  }
}
