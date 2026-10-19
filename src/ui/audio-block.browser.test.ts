import { testEngines } from '../test-utils/test-engines';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { Browser, Page } from 'playwright';
import { bootPlayer, enterTheater } from '../test-utils/player-boot';

const DRM_NOTE = 'Audio settings are unavailable: this video is DRM-protected.';

function fixture(drm: boolean): string {
  return `<!doctype html><html><head><title>Audio block</title>
    <style>body { margin:0; background:#111; } video { width:960px; height:540px; background:#000; }</style>
    </head><body><div class="video-js"><video id="player" title="Audio block" muted playsinline></video></div>
    <script>
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 180;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1c2634';
      ctx.fillRect(0, 0, 320, 180);
      setInterval(() => { ctx.fillRect(0, 0, 1, 1); }, 100);
      const video = document.getElementById('player');
      video.srcObject = canvas.captureStream(12);
      video.play();
      window.markDrm = () => {
        // A MediaKeys object is what Web Audio cannot read through.
        Object.defineProperty(video, 'mediaKeys', { get: () => ({}) });
        video.dispatchEvent(new Event('encrypted'));
      };
      ${drm ? 'window.markDrm();' : ''}
    </script></body></html>`;
}

async function boot(page: Page, drm: boolean): Promise<void> {
  await page.route('http://audio-block.test/**', route => route.fulfill({ contentType: 'text/html', body: fixture(drm) }));
  await page.goto('http://audio-block.test/');
  await bootPlayer(page, { settings: { keepControlsVisible: true } });
  await page.waitForFunction(() => (document.querySelector('video') as HTMLVideoElement).readyState >= 2);
  await enterTheater(page);
  await page.locator('.player-settings-btn').click();
  await page.locator('.theater-settings-menu.visible').waitFor();
}

async function audioMenu(page: Page) {
  // A string avoids a transpiler helper that does not exist in the page.
  return page.evaluate(`(() => {
    const root = document.getElementById('theater-everywhere-ui').shadowRoot;
    const visible = (element) => Boolean(element && element.getClientRects().length);
    const note = root.querySelector('.theater-settings-note');
    return {
      note: visible(note) ? note.textContent : null,
      rows: [...root.querySelectorAll('.theater-settings-menu .volume-boost-btn, .theater-settings-menu [class*="audio-"]')]
        .filter(visible).length,
      heading: visible(root.querySelector('[data-settings-section="audio"] .theater-settings-heading'))
    };
  })()`) as Promise<{ note: string | null; rows: number; heading: boolean }>;
}

async function withBrowser(engine: 'chromium' | 'firefox', run: (page: Page) => Promise<void>): Promise<void> {
  const browserType = (await import('playwright'))[engine];
  assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
  const browser: Browser = await browserType.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

describe('audio settings on protected media', () => {
  for (const engine of testEngines()) {
    it(`replaces the audio rows with one explanation for DRM video in ${engine}`, { timeout: 60_000 }, async () => {
      await withBrowser(engine, async page => {
        await boot(page, true);
        assert.deepEqual(await audioMenu(page), { note: DRM_NOTE, rows: 0, heading: true });
        await page.keyboard.press('v');
        await page.locator('.status-hud').waitFor();
        assert.equal(await page.locator('.status-hud').textContent(), DRM_NOTE);
      });
    });

    it(`restores the audio rows for ordinary video and reacts when DRM appears in ${engine}`, { timeout: 60_000 }, async () => {
      await withBrowser(engine, async page => {
        await boot(page, false);
        assert.deepEqual(await audioMenu(page), { note: null, rows: 4, heading: true });
        await page.evaluate('window.markDrm()');
        await page.waitForFunction(() => {
          const note = document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-settings-note');
          return Boolean(note && (note as HTMLElement).getClientRects().length);
        });
        assert.deepEqual(await audioMenu(page), { note: DRM_NOTE, rows: 0, heading: true });
      });
    });
  }
});
