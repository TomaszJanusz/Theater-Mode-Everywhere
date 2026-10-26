import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { it } from 'node:test';

import type { Page } from 'playwright';
import { chromium, firefox } from 'playwright';

import { readStylesheet } from '../test-utils/styles';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild') as { buildSync(options: object): { outputFiles: Array<{ text: string }> } };
const BUNDLE = esbuild.buildSync({
  stdin: { contents: "import { bootstrapPlayerRuntime } from './ui/player-runtime'; bootstrapPlayerRuntime();", resolveDir: new URL('../', import.meta.url).pathname, loader: 'ts' },
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;
const CSS = readStylesheet(new URL('../content.css', import.meta.url));
const MEDIA = `data:video/webm;base64,${readFileSync(new URL('../../test/fixtures/vod.webm', import.meta.url)).toString('base64')}`;

/**
 * A post list shaped like Telegram's public channel page (t.me/s/…): every post bubble has a
 * drop-shadow filter, which makes it the containing block of a fixed video until the theater
 * ancestor overrides clear it. The other posts use a transform and paint containment instead.
 */
const POST_LIST = `<style>
  body { margin: 0; background: #e5ebef; }
  .history { width: 480px; margin: 40px auto; }
  .bubble { position: relative; margin: 0 0 120px 60px; background: #fff; filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1)); }
  .bubble.transformed { filter: none; transform: translateZ(0); }
  .bubble.contained { filter: none; contain: paint; }
  .player { position: relative; display: block; overflow: hidden; }
  .wrap { position: relative; overflow: hidden; padding-top: 56.25%; }
  .wrap video { position: absolute; inset: 0; width: 100%; height: 100%; }
</style>
<section class="history">
  ${['shadowed', 'transformed', 'contained'].map((kind, index) => `<div class="bubble ${kind}" data-post="videos/${index + 1}">
    <a class="player"><div class="wrap"><video id="${kind}" muted src="${MEDIA}"></video></div></a>
    <p>Post ${index + 1}</p>
  </div>`).join('')}
</section>`;

async function openPostList(page: Page): Promise<void> {
  await page.route('http://post-list.test/**', route => route.fulfill({ contentType: 'text/html', body: POST_LIST }));
  await page.goto('http://post-list.test/s/videos');
  await page.addScriptTag({ content: 'window.__name = target => target;' });
  await page.addStyleTag({ content: CSS });
  await page.addScriptTag({ content: BUNDLE });
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
  await page.waitForFunction(() => [...document.querySelectorAll('video')].every(video => video.readyState >= 1));
}

/** The active video's box in the viewport. */
const activeBox = (page: Page) => page.evaluate(() => {
  const video = document.querySelector<HTMLVideoElement>('video[data-theater-everywhere]')!;
  const box = video.getBoundingClientRect();
  return { id: video.id, left: Math.round(box.left), top: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) };
});

for (const engine of testEngines()) {
  const shared = sharedTestBrowser(({ chromium, firefox })[engine]);

  for (const id of ['shadowed', 'transformed', 'contained']) {
    it(`${engine}: theater entry pins a ${id} post's video to the viewport and exit restores the post`, { timeout: 60_000 }, async t => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      await openPostList(page);
      // Put the post in the middle of the viewport, away from the origin the pin is measured from.
      await page.locator(`#${id}`).evaluate(video => video.scrollIntoView({ block: 'center' }));
      await page.locator(`#${id}`).dispatchEvent('mousemove', { bubbles: true });
      await page.keyboard.press('t');
      await page.waitForFunction(() => document.documentElement.classList.contains('theater-everywhere-html-active'));
      // Before the overrides the bubble is the containing block; a pin measured then left the video
      // shifted up and left by the bubble's offset (TME-140).
      assert.deepEqual(await activeBox(page), { id, left: 0, top: 0, width: 1280, height: 720 });

      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
      assert.deepEqual(await page.evaluate(() => ({
        styled: [...document.querySelectorAll('video')].filter(video => video.hasAttribute('style')).map(video => video.id),
        overridden: document.querySelectorAll('.theater-everywhere-parent-active').length,
        stage: document.getElementById('theater-everywhere-stage') !== null,
        inPost: [...document.querySelectorAll('video')].every(video => {
          const box = video.getBoundingClientRect();
          const wrap = video.parentElement!.getBoundingClientRect();
          return box.left === wrap.left && box.top === wrap.top && box.width === wrap.width;
        })
      })), { styled: [], overridden: 0, stage: false, inPost: true });
    });
  }
}
