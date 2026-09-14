import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, firefox, type BrowserContext, type Page } from 'playwright';

type SmokeBrowser = 'chromium' | 'firefox';

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_PATH = path.join(ROOT, 'test/fixtures/local-player.html');
const THEATER_VIDEO_CLASS = 'theater-everywhere-video-active';
const THEATER_HTML_CLASS = 'theater-everywhere-html-active';

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

function startFixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const html = readFileSync(FIXTURE_PATH);
  const server = createServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    });
    res.end(html);
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}/`,
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

async function assertTheaterToggle(page: Page): Promise<void> {
  await page.click('video#player');
  await page.keyboard.press('t');
  await page.waitForFunction(({ videoClass, htmlClass }) => {
    const video = document.querySelector('video#player');
    return Boolean(video?.classList.contains(videoClass) || document.documentElement.classList.contains(htmlClass));
  }, { videoClass: THEATER_VIDEO_CLASS, htmlClass: THEATER_HTML_CLASS }, { timeout: 10_000 });

  const entered = await page.evaluate(({ videoClass, htmlClass }) => {
    const video = document.querySelector('video#player');
    return {
      video: Boolean(video?.classList.contains(videoClass)),
      html: document.documentElement.classList.contains(htmlClass)
    };
  }, { videoClass: THEATER_VIDEO_CLASS, htmlClass: THEATER_HTML_CLASS });
  if (!entered.video && !entered.html) {
    fail('Theater mode did not activate after T.');
  }

  await page.keyboard.press('Escape');
  await page.waitForFunction(({ videoClass, htmlClass }) => {
    const video = document.querySelector('video#player');
    return !video?.classList.contains(videoClass) && !document.documentElement.classList.contains(htmlClass);
  }, { videoClass: THEATER_VIDEO_CLASS, htmlClass: THEATER_HTML_CLASS }, { timeout: 10_000 });
}

async function injectBundledPlayer(page: Page, unpackedDir: string): Promise<void> {
  const cssPath = path.join(unpackedDir, 'content.css');
  const jsPath = path.join(unpackedDir, 'content.js');
  await page.addStyleTag({ path: cssPath });
  const source = readFileSync(jsPath, 'utf8');
  const isModule = /^\s*export\b/m.test(source) || /^\s*import\b/m.test(source);
  await page.addScriptTag({ path: jsPath, type: isModule ? 'module' : undefined });
  await delay(400);
}

async function smokeChromium(url: string, unpackedDir: string): Promise<void> {
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
        `--disable-extensions-except=${unpackedDir}`,
        `--load-extension=${unpackedDir}`
      ]
    });

    const page = context.pages()[0] || await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await assertTheaterToggle(page);
    console.log('smoke:chromium passed (unpacked MV3 extension)');
  } finally {
    await context?.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function smokeFirefox(url: string, unpackedDir: string): Promise<void> {
  if (!playwrightExecutable('firefox')) {
    skipLocally('Skipping smoke:firefox. Run: pnpm exec playwright install chromium firefox');
  }

  const browser = await firefox.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await injectBundledPlayer(page, unpackedDir);
    await assertTheaterToggle(page);
    console.log('smoke:firefox passed (injected bundled content.js; Playwright cannot load MV3 addons)');
  } finally {
    await browser.close();
  }
}

async function run(): Promise<void> {
  if (!existsSync(FIXTURE_PATH)) fail(`Missing fixture ${FIXTURE_PATH}`);

  const targets = requestedBrowsers();
  const fixture = await startFixtureServer();
  try {
    for (const kind of targets) {
      const unpackedDir = requireBuiltExtension(kind);
      if (kind === 'chromium') await smokeChromium(fixture.url, unpackedDir);
      else await smokeFirefox(fixture.url, unpackedDir);
    }
  } finally {
    await fixture.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
