import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chromium, firefox } from 'playwright';

import { openStory, selectTimeline, waitForStory } from '../.storybook/browser-navigation';
import { environment } from '../.storybook/profiles';
import { serveStorybook } from '../.storybook/static-server';
import { sharedTestBrowser } from '../src/test-utils/test-browser';
import { testEngines } from '../src/test-utils/test-engines';

for (const engine of testEngines()) {
  const browser = sharedTestBrowser({ chromium, firefox }[engine]);
  test(`Storybook timeline rebuilds timer states, args and locale without stale work (${engine})`, { timeout: 60000 }, async t => {
    const server = await serveStorybook();
    t.after(server.close);
    const context = await browser.newContext(t);
    const page = await context.newPage();
    await openStory(page, server.url, 'components-hud--volume', environment());
    for (let replay = 0; replay < 2; replay++) {
      await selectTimeline(page, 'leave');
      assert.equal(await page.locator('.theater-everywhere-volume-overlay').evaluate(node => node.classList.contains('fade-out')), true);
      const opacity = await page.locator('.theater-everywhere-volume-overlay').evaluate(node => Number(getComputedStyle(node).opacity));
      assert.ok(opacity > 0 && opacity < 1, `real held fade: ${opacity}`);
      const oldHost = await page.locator('#theater-everywhere-ui').elementHandle();
      const oldFrame = await page.evaluateHandle(() => window.__storyFrame!);
      await selectTimeline(page, 'enter');
      assert.equal(await oldHost!.evaluate(node => node.isConnected), false);
      assert.equal(await oldFrame.evaluate(frame => frame(0.9)), 0);
      assert.equal(await page.locator('.theater-everywhere-volume-overlay').evaluate(node => node.classList.contains('fade-out')), false);
      await selectTimeline(page, 'hold');
      assert.equal(await page.locator('.theater-everywhere-volume-overlay').textContent(), '65%');
    }
    const original = await page.locator('#theater-everywhere-ui').elementHandle();
    await page.evaluate(() => {
      const channel = (window as unknown as { __STORYBOOK_ADDONS_CHANNEL__: { emit(type: string, payload: unknown): void } }).__STORYBOOK_ADDONS_CHANNEL__;
      channel.emit('updateStoryArgs', { storyId: 'components-hud--volume', updatedArgs: { amount: 0.3, direction: 'down' } });
    });
    await page.waitForFunction(() => window.__storyState?.args.amount === 0.3);
    await waitForStory(page);
    assert.equal(await original!.evaluate(node => node.isConnected), false);
    assert.equal(await page.locator('.theater-everywhere-volume-overlay').textContent(), '30%');
    await page.evaluate(() => {
      const channel = (window as unknown as { __STORYBOOK_ADDONS_CHANNEL__: { emit(type: string, payload: unknown): void } }).__STORYBOOK_ADDONS_CHANNEL__;
      channel.emit('updateGlobals', { globals: { locale: 'ar', reduceMotion: 'on' } });
    });
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.lang === 'ar');
    await waitForStory(page);
    assert.equal(await page.locator('#theater-everywhere-ui').getAttribute('dir'), 'rtl');
    assert.equal(await page.locator('#theater-everywhere-ui').getAttribute('data-motion'), 'reduced');

    await openStory(page, server.url, 'components-hud--seek-both', environment());
    await selectTimeline(page, 'leave');
    assert.equal(await page.locator('.theater-everywhere-seek-overlay').count(), 2);
    await selectTimeline(page, 'enter');
    assert.equal(await page.locator('.theater-everywhere-seek-overlay').count(), 2);

    const caption = environment();
    caption.args = { detail: 'Custom fixture detail' };
    await openStory(page, server.url, 'components-caption-notice--status', caption);
    await selectTimeline(page, 'leave');
    assert.equal(await page.locator('.theater-everywhere-caption-hud').evaluate(node => node.classList.contains('fade-out')), true);
    const opacity = await page.locator('.theater-everywhere-caption-hud').evaluate(node => Number(getComputedStyle(node).opacity));
    assert.ok(opacity > 0 && opacity < 1, `real held caption fade: ${opacity}`);
    await selectTimeline(page, 'enter');
    assert.equal(await page.locator('.theater-everywhere-caption-hud').evaluate(node => node.classList.contains('fade-out')), false);

    await openStory(page, server.url, 'components-auto-theater-notice--counting', environment());
    await selectTimeline(page, 'leave');
    assert.equal(await page.locator('.theater-time-glyph:not(.is-leaving)').textContent(), '0');
    await selectTimeline(page, 'enter');
    assert.equal(await page.locator('.theater-time-glyph:not(.is-leaving)').textContent(), '4');
    await selectTimeline(page, 'live');
    await selectTimeline(page, 'hold');
    await selectTimeline(page, 'live');
    await selectTimeline(page, 'hold');
    assert.equal(await page.locator('.theater-auto-notice').count(), 1);

    for (const id of ['components-volume-control--closed', 'components-title-hud--short', 'components-caption-notice--loading']) {
      await openStory(page, server.url, id, environment());
      await selectTimeline(page, 'leave');
      assert.equal(await page.evaluate(() => window.__storyState?.timelineSupported), false);
      assert.equal(await page.locator('.fade-out').count(), 0);
    }
  });
}
