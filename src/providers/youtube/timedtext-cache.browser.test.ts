import { selectTestEngines } from '../../test-utils/test-engines';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { chromium, firefox, type BrowserType, type Page } from 'playwright';
import { ownTestBrowser } from '../../test-utils/test-browser';

type CaptionApi = {
  installYoutubeMain(): void;
  cacheTimedtextBody(url: string, body: string): void;
  readCachedTimedtextBody(url: string): string | null;
  readTimedtextCacheUsage(): { retainedStringLength: number; stringBudget: number; tracks: number };
};

const require = createRequire(import.meta.url);
const esbuild = require(createRequire(require.resolve('vite')).resolve('esbuild')) as {
  buildSync(options: Record<string, unknown>): { outputFiles: Array<{ text: string }> };
};
const source = path.resolve(new URL('../..', import.meta.url).pathname);
const bundle = esbuild.buildSync({
  stdin: {
    contents: "export { installYoutubeMain, cacheTimedtextBody, readCachedTimedtextBody, readTimedtextCacheUsage } from './providers/youtube/main';",
    resolveDir: source,
    loader: 'ts'
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'CaptionTest',
  platform: 'browser',
  target: 'es2022'
}).outputFiles[0].text;

const engines: Array<[string, BrowserType]> = selectTestEngines<[string, BrowserType]>([['chromium', chromium], ['firefox', firefox]], ([name]) => name);

async function install(page: Page): Promise<void> {
  await page.addScriptTag({ content: 'window.__name = (fn) => fn;' });
  await page.addScriptTag({ content: `${bundle}\nwindow.CaptionTest = CaptionTest;` });
  await page.evaluate('window.CaptionTest.installYoutubeMain()');
}

describe('YouTube timedtext cache budget', () => {
  for (const [name, engine] of engines) {
    it(`serves the active track, refuses a stale identity, and stays inside the budget in ${name}`, async (t) => {
      if (!existsSync(engine.executablePath())) {
        t.skip('Browser not installed');
        return;
      }
      const browser = await engine.launch({ headless: true });
      ownTestBrowser(t, browser);
      const page = await browser.newPage();
      await page.route('https://www.youtube.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><div id="movie_player"><video></video><button class="ytp-subtitles-button" aria-pressed="false">CC</button></div>'
      }));
      await page.goto('https://www.youtube.com/watch?v=video-a');
      await install(page);
      const report = await page.evaluate(() => {
        const api = (window as unknown as { CaptionTest: CaptionApi }).CaptionTest;
        const track = (video: string, lang: string, pot = '') =>
          `https://www.youtube.com/api/timedtext?v=${video}&lang=${lang}&fmt=json3${pot}`;
        api.cacheTimedtextBody(track('video-a', 'en', '&pot=TOKEN'), 'english-body');
        api.cacheTimedtextBody(track('video-a', 'en', '&pot=TOKEN'), 'english-body');
        api.cacheTimedtextBody(track('video-a', 'pl', '&pot=PL'), 'polish-body');
        const english = api.readCachedTimedtextBody(track('video-a', 'en'));
        const polish = api.readCachedTimedtextBody(track('video-a', 'pl'));
        const arabic = api.readCachedTimedtextBody(track('video-a', 'ar'));
        history.replaceState(null, '', '/watch?v=video-b');
        window.dispatchEvent(new Event('yt-navigate-start'));
        const staleForNewVideo = api.readCachedTimedtextBody(track('video-b', 'en'));
        const returned = api.readCachedTimedtextBody(track('video-a', 'en'));
        window.dispatchEvent(new CustomEvent('theater-everywhere-youtube-captions', {
          detail: { enabled: false, requestId: 'off' }
        }));
        const video = document.querySelector('video');
        const replacement = document.createElement('video');
        video?.replaceWith(replacement);
        replacement.dispatchEvent(new Event('loadstart', { bubbles: true }));
        const afterReplace = api.readCachedTimedtextBody(track('video-a', 'en'));
        for (let index = 0; index < 40; index++) {
          const videoId = `cycle-${index}`;
          const lang = index % 2 === 0 ? 'en' : 'pl';
          history.replaceState(null, '', `/watch?v=${videoId}`);
          window.dispatchEvent(new Event('yt-navigate-start'));
          const body = `${String(index).padStart(6, '0')}${'x'.repeat(800_000 - 6)}`;
          api.cacheTimedtextBody(track(videoId, lang, '&pot=POT'), body);
          api.readCachedTimedtextBody(track(videoId, lang));
        }
        history.replaceState(null, '', '/watch?v=cycle-36');
        window.dispatchEvent(new Event('yt-navigate-start'));
        window.dispatchEvent(new Event('yt-navigate-finish'));
        const usage = api.readTimedtextCacheUsage();
        const auth = document.getElementById('theater-everywhere-youtube-caption-auth')?.textContent || '';
        return {
          ok: usage.retainedStringLength <= usage.stringBudget,
          english,
          polish,
          arabic,
          staleForNewVideo,
          returned,
          afterReplace,
          first: api.readCachedTimedtextBody(track('cycle-0', 'en')),
          previous: api.readCachedTimedtextBody(track('cycle-38', 'en')),
          latest: api.readCachedTimedtextBody(track('cycle-39', 'pl')),
          evictedBody: api.readCachedTimedtextBody(track('cycle-36', 'en')),
          retained: usage.retainedStringLength,
          tracks: usage.tracks,
          budget: usage.stringBudget,
          authKeepsEvictedPot: auth.includes('cycle-36') && auth.includes('pot=POT')
        };
      });
      assert.equal(report.english, 'english-body');
      assert.equal(report.polish, 'polish-body');
      assert.equal(report.arabic, null);
      assert.equal(report.staleForNewVideo, null);
      assert.equal(report.returned, 'english-body');
      assert.equal(report.afterReplace, 'english-body');
      assert.equal(report.ok, true);
      assert.equal(report.first, null);
      assert.equal(report.evictedBody, null);
      assert.ok(report.latest?.startsWith('000039'));
      assert.ok(report.previous?.startsWith('000038'));
      assert.ok(report.retained <= report.budget);
      assert.ok(report.tracks <= 3);
      assert.equal(report.authKeepsEvictedPot, true);
    });

    it(`bounds the top-frame copy of an embedded timedtext body in ${name}`, async (t) => {
      if (!existsSync(engine.executablePath())) {
        t.skip('Browser not installed');
        return;
      }
      const browser = await engine.launch({ headless: true });
      ownTestBrowser(t, browser);
      const page = await browser.newPage();
      await page.route('https://www.youtube.com/**', (route) => {
        const embed = route.request().url().includes('/embed/');
        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: embed
            ? '<!doctype html><div id="movie_player"><video></video></div>'
            : '<!doctype html><iframe id="child" src="https://www.youtube.com/embed/video-a"></iframe><div id="movie_player"><video></video></div>'
        });
      });
      await page.goto('https://www.youtube.com/watch?v=video-a');
      await install(page);
      const frame = page.frame({ url: /\/embed\// });
      assert.ok(frame);
      await frame.addScriptTag({ content: 'window.__name = (fn) => fn;' });
      await frame.addScriptTag({ content: `${bundle}\nwindow.CaptionTest = CaptionTest;` });
      await frame.evaluate('window.CaptionTest.installYoutubeMain()');
      await frame.evaluate(() => {
        for (let index = 0; index < 20; index++) {
          const body = `${String(index).padStart(6, '0')}${'y'.repeat(800_000 - 6)}`;
          (window as unknown as { CaptionTest: CaptionApi }).CaptionTest.cacheTimedtextBody(
            `https://www.youtube.com/api/timedtext?v=embed-${index}&lang=en&fmt=json3&pot=EMBED`,
            body
          );
        }
      });
      await page.waitForFunction('window.CaptionTest.readTimedtextCacheUsage().tracks > 0');
      const usage = await page.evaluate(() => (window as unknown as { CaptionTest: CaptionApi }).CaptionTest.readTimedtextCacheUsage());
      const latest = await page.evaluate(() => (window as unknown as { CaptionTest: CaptionApi }).CaptionTest.readCachedTimedtextBody(
        'https://www.youtube.com/api/timedtext?v=embed-19&lang=en&fmt=json3'
      ));
      const oldest = await page.evaluate(() => (window as unknown as { CaptionTest: CaptionApi }).CaptionTest.readCachedTimedtextBody(
        'https://www.youtube.com/api/timedtext?v=embed-0&lang=en&fmt=json3'
      ));
      assert.ok(usage.retainedStringLength <= usage.stringBudget);
      assert.ok(usage.tracks <= 3);
      assert.ok(latest?.startsWith('000019'));
      assert.equal(oldest, null);
    });
  }
});
