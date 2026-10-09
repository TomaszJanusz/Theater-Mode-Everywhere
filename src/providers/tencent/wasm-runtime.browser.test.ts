import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { chromium, type BrowserContext, type Page } from 'playwright';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname, '..');
const EXTENSION = path.join(ROOT, 'dist', 'chrome-unpacked');
const PAGE_URL = 'https://v.qq.com/x/cover/mzc00200803dr6b/c4102g9a01t.html';
const FRAME_URL = 'https://vm.gtimg.cn/thumbplayer/txv/wasm/1.0.53/fake-video-element-iframe.html';
const VIDEO_PAGE = 'https://example.com/plain-video.html';

const PLAYER_HTML = `<!doctype html>
<html>
<body>
  <div class="txp_player">
    <div class="txp-layer" id="chrome">tencent chrome</div>
    <div class="txp_controls">
      <button class="txp_btn txp_btn_next_u" id="next">next</button>
    </div>
    <div class="txp_videos_container">
      <video id="empty" width="320" height="180"></video>
      <fake-iframe-video id="player" style="display:block;width:800px;height:450px"></fake-iframe-video>
    </div>
  </div>
  <script>
    class FakeIframeVideo extends HTMLElement {
      constructor() {
        super();
        this._paused = false;
        this._time = 10;
        this._duration = 120;
        this._volume = 1;
        this._muted = false;
        this._rate = 1;
        this._ready = 4;
        this._seeking = false;
        this._ended = false;
        this.playCalls = 0;
        this.pauseCalls = 0;
        this.seekSets = [];
        const shadow = this.attachShadow({ mode: 'open' });
        const frame = document.createElement('iframe');
        frame.src = ${JSON.stringify(FRAME_URL)};
        frame.style.cssText = 'width:100%;height:100%;border:0';
        shadow.appendChild(frame);
      }
      play() {
        this.playCalls += 1;
        this._paused = false;
        this.dispatchEvent(new Event('play'));
        return Promise.resolve();
      }
      pause() {
        this.pauseCalls += 1;
        this._paused = true;
        this.dispatchEvent(new Event('pause'));
      }
      get paused() { return this._paused; }
      get ended() { return this._ended; }
      get seeking() { return this._seeking; }
      get currentTime() { return this._time; }
      set currentTime(value) {
        this.seekSets.push(value);
        this._time = value;
        this._seeking = true;
        this.dispatchEvent(new Event('seeking'));
      }
      get duration() { return this._duration; }
      get volume() { return this._volume; }
      set volume(value) { this._volume = value; this.dispatchEvent(new Event('volumechange')); }
      get muted() { return this._muted; }
      set muted(value) { this._muted = value; this.dispatchEvent(new Event('volumechange')); }
      get playbackRate() { return this._rate; }
      set playbackRate(value) { this._rate = value; this.dispatchEvent(new Event('ratechange')); }
      get readyState() { return this._ready; }
      get buffered() { return { length: 1, start: () => 0, end: () => this._time }; }
      supportPictureInPicture() { return false; }
      requestPictureInPicture() { return Promise.resolve(); }
    }
    if (!customElements.get('fake-iframe-video')) customElements.define('fake-iframe-video', FakeIframeVideo);
    window.__counts = (id) => {
      const el = document.getElementById(id);
      return { play: el.playCalls, pause: el.pauseCalls, seeks: el.seekSets.slice() };
    };
  </script>
</body>
</html>`;

const FRAME_HTML = `<!doctype html><html><body><video id="inner-empty"></video></body></html>`;
const PLAIN_HTML = `<!doctype html><html><body><video id="plain" src="https://example.com/clip.mp4" width="640" height="360" style="width:640px;height:360px"></video></body></html>`;

function extensionReady(): boolean {
  return existsSync(path.join(EXTENSION, 'content.js')) && existsSync(path.join(EXTENSION, 'manifest.json'));
}

async function dismissDialog(page: Page): Promise<void> {
  const button = page.locator('.te-dialog-btn-primary');
  if (await button.count()) await button.first().click();
}

describe('tencent wasm theater runtime', () => {
  it('drives the fake player from the page and from the wasm frame', async (t) => {
    if (!extensionReady()) {
      t.skip('dist/chrome-unpacked is missing; run pnpm build');
      return;
    }
    const userData = mkdtempSync(path.join(tmpdir(), 'te-wasm-'));
    let context: BrowserContext | null = null;
    try {
      context = await chromium.launchPersistentContext(userData, {
        headless: false,
        viewport: { width: 1280, height: 720 },
        args: [
          '--headless=new',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          `--disable-extensions-except=${EXTENSION}`,
          `--load-extension=${EXTENSION}`
        ]
      });
      await (context.serviceWorkers()[0] ? Promise.resolve() : context.waitForEvent('serviceworker'));
      await context.route('https://v.qq.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: PLAYER_HTML
      }));
      await context.route('https://vm.gtimg.cn/**', (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: FRAME_HTML
      }));
      await context.route('https://example.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: PLAIN_HTML
      }));
      const page = await context.newPage();
      await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
      await dismissDialog(page);

      await page.keyboard.press('t');
      await page.waitForFunction(() => document.documentElement.classList.contains('theater-everywhere-html-active'));
      const enteredOnFake = await page.evaluate(() => ({
        fake: document.getElementById('player')?.hasAttribute('data-theater-everywhere') === true,
        empty: document.getElementById('empty')?.hasAttribute('data-theater-everywhere') === true,
        width: document.getElementById('player')?.getBoundingClientRect().width || 0,
        chrome: getComputedStyle(document.getElementById('chrome')!).visibility,
        nextDisplay: getComputedStyle(document.getElementById('next')!).display
      }));
      assert.equal(enteredOnFake.fake, true);
      assert.equal(enteredOnFake.empty, false);
      assert.ok(enteredOnFake.width > 200);
      assert.equal(enteredOnFake.chrome, 'hidden');
      assert.notEqual(enteredOnFake.nextDisplay, 'none');
      const nextClicks = await page.evaluate(() => {
        const button = document.getElementById('next')!;
        let clicks = 0;
        button.addEventListener('click', () => { clicks += 1; });
        button.click();
        return clicks;
      });
      assert.equal(nextClicks, 1);

      await page.keyboard.press(' ');
      await page.waitForFunction(() => (document.getElementById('player') as { pauseCalls?: number }).pauseCalls === 1);
      await page.keyboard.press(' ');
      await page.waitForFunction(() => (document.getElementById('player') as { playCalls?: number }).playCalls === 1);
      await page.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, repeat: true }));
      });
      const afterHold = await page.evaluate(() => (window as unknown as {
        __counts(id: string): { play: number; pause: number; seeks: number[] };
      }).__counts('player'));
      assert.deepEqual(afterHold, { play: 1, pause: 1, seeks: [] });

      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => (document.getElementById('player') as { seekSets?: number[] }).seekSets?.length === 1);
      const afterSeek = await page.evaluate(() => (window as unknown as {
        __counts(id: string): { play: number; pause: number; seeks: number[] };
      }).__counts('player'));
      assert.equal(afterSeek.seeks.length, 1);
      assert.equal(afterSeek.seeks[0], 15);

      await page.keyboard.press('f');
      await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('theater-everywhere-html-active')), true);
      await page.keyboard.press('f');
      await page.waitForFunction(() => document.fullscreenElement == null);

      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
      assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('chrome')!).visibility), 'visible');

      const frame = page.frames().find((item) => item.url().startsWith('https://vm.gtimg.cn/'));
      assert.ok(frame);
      await frame.evaluate(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true }));
      });
      await page.waitForFunction(() => document.getElementById('player')?.hasAttribute('data-theater-everywhere') === true);
      assert.equal(await frame.evaluate(() => document.documentElement.classList.contains('theater-everywhere-html-active')), false);

      await page.evaluate(() => {
        const current = document.getElementById('player')!;
        const next = document.createElement('fake-iframe-video') as HTMLElement;
        next.id = 'player-2';
        next.style.cssText = 'display:block;width:800px;height:450px';
        current.replaceWith(next);
      });
      await page.waitForFunction(() => document.getElementById('player-2')?.hasAttribute('data-theater-everywhere') === true);
      await page.evaluate(() => {
        const current = document.getElementById('player-2')!;
        const next = document.createElement('fake-iframe-video') as HTMLElement;
        next.id = 'player-3';
        next.style.cssText = 'display:block;width:800px;height:450px';
        current.replaceWith(next);
      });
      await page.waitForFunction(() => document.getElementById('player-3')?.hasAttribute('data-theater-everywhere') === true);
      // Exit immediately, then re-enter through the replacement's own frame.
      // This verifies reverse states without depending on the page toggle guard.
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
      await page.frameLocator('#player-3 iframe').locator('body').press('t');
      await page.waitForFunction(() => document.getElementById('player-3')?.hasAttribute('data-theater-everywhere') === true);
      await page.keyboard.press('Escape');

      const plain = await context.newPage();
      await plain.goto(VIDEO_PAGE, { waitUntil: 'domcontentloaded' });
      await plain.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
      await dismissDialog(plain);
      await plain.keyboard.press('t');
      await plain.waitForFunction(() => document.getElementById('plain')?.hasAttribute('data-theater-everywhere') === true);
      assert.equal(await plain.evaluate(() => document.documentElement.classList.contains('theater-everywhere-tencent-stage')), false);
    } finally {
      await context?.close();
      rmSync(userData, { recursive: true, force: true });
    }
  });
});
