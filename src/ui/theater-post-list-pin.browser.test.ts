import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

import type { Page } from 'playwright';
import { chromium, firefox } from 'playwright';

import { bootPlayer } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';

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
  await bootPlayer(page);
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
  await page.waitForFunction(() => [...document.querySelectorAll('video')].every(video => video.readyState >= 1));
}

const activeVideo = (page: Page) => page.locator('video[data-theater-everywhere]').evaluate(video => video.id);

/** The active video's box in the viewport. */
const activeBox = (page: Page) => page.evaluate(() => {
  const video = document.querySelector<HTMLVideoElement>('video[data-theater-everywhere]')!;
  const box = video.getBoundingClientRect();
  return { left: Math.round(box.left), top: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) };
});

const viewport = (page: Page) => page.evaluate(() => ({ width: innerWidth, height: innerHeight }));

for (const engine of testEngines()) {
  const shared = sharedTestBrowser(({ chromium, firefox })[engine]);

  // The transform and the paint containment are containing blocks of a fixed video just as the
  // shadowed bubble's filter is; entry lands on the post under the pointer, away from the first one.
  for (const id of ['transformed', 'contained']) {
    it(`${engine}: theater entry pins a ${id} post's video to the viewport and exit restores the post`, { timeout: 60_000 }, async t => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      await openPostList(page);
      await page.locator(`#${id}`).evaluate(video => video.scrollIntoView({ block: 'center' }));
      await page.locator(`#${id}`).dispatchEvent('mousemove', { bubbles: true });
      await page.keyboard.press('t');
      await page.waitForFunction(() => document.documentElement.classList.contains('theater-everywhere-html-active'));
      assert.equal(await activeVideo(page), id);
      const size = await viewport(page);
      assert.deepEqual(await activeBox(page), { left: 0, top: 0, width: size.width, height: size.height });

      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
      assert.deepEqual(await page.evaluate(() => ({
        styled: document.querySelectorAll('video[style]').length,
        overridden: document.querySelectorAll('.theater-everywhere-parent-active').length
      })), { styled: 0, overridden: 0 });
    });
  }

  it(`${engine}: entry and Switch Video pin each post's video to the viewport and exit restores every post`, { timeout: 60_000 }, async t => {
    const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
    await openPostList(page);
    const size = await viewport(page);
    const fullViewport = { left: 0, top: 0, width: size.width, height: size.height };

    await page.locator('#shadowed').dispatchEvent('mousemove', { bubbles: true });
    await page.keyboard.press('t');
    await page.waitForFunction(() => document.documentElement.classList.contains('theater-everywhere-html-active'));
    assert.equal(await activeVideo(page), 'shadowed');
    // Before the overrides the bubble is the containing block; a pin measured then left the video
    // shifted up and left by the bubble's offset (TME-140).
    assert.deepEqual(await activeBox(page), fullViewport, 'entry');

    // Switch Video pinned the next post's video against its own bubble the same way.
    for (const next of ['transformed', 'contained', 'shadowed']) {
      await page.keyboard.press('Shift+T');
      await page.waitForFunction(id => document.querySelector('video[data-theater-everywhere]')?.id === id, next);
      assert.deepEqual(await activeBox(page), fullViewport, `${next} after Switch Video`);
      assert.equal(
        await page.evaluate(id => [...document.querySelectorAll('video')].filter(video => video.id !== id && video.hasAttribute('style')).length, next),
        0,
        'the previous video keeps no theater styles'
      );
    }

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
