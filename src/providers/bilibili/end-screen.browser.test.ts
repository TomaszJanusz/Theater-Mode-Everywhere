import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { chromium, firefox } from 'playwright';

import { bootPlayer, bundlePlayer, enterTheater } from '../../test-utils/player-boot';
import { sharedTestBrowser } from '../../test-utils/test-browser';
import { testEngines } from '../../test-utils/test-engines';
import { serveFixture, vodVideoFixture } from '../../test-utils/video-fixtures';
import type { EndScreenItem } from '../end-screen-view';

const recorded = readFileSync(new URL('../../../test/host-fixtures/bilibili-end-screen.html', import.meta.url), 'utf8');
const url = 'https://www.bilibili.com/video/BV1HHxv6KETZ/';
// The recorded text is Chinese: serveFixture sends no charset, so the page declares it.
const fixture = vodVideoFixture({ title: 'Bilibili end-screen fixture' }).replace('<head>', '<head><meta charset="utf-8">').replace('<body>', '<body>' + recorded);
// The sidebar card i is the panel's tile i: the BV ids the host navigates to.
const ids = [...new Set([...recorded.matchAll(/href="[^"]*\/video\/(BV[0-9A-Za-z]{10})/g)].map(match => match[1]))];

describe('Bilibili end tiles and autoplay (recorded DOM fixture, not live host evidence)', () => {
  for (const engine of testEngines()) {
    const browser = sharedTestBrowser(({ chromium, firefox })[engine]);
    it(`tiles, native autoplay countdown/cancel, navigation, stale visits and cleanup in ${engine}`, { timeout: 90_000 }, async t => {
      assert.equal(ids.length, 4);
      const page = await (await browser.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      page.setDefaultTimeout(8000);
      await serveFixture(page, fixture, url);
      // The recorded cover URLs stay intact; fixture checks never contact the image CDN.
      await page.route('https://*.hdslb.com/**', route => route.fulfill({ contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#334155"/></svg>' }));
      await page.evaluate(bvids => {
        const root = document.querySelector<HTMLElement>('.bpx-player-container')!;
        root.prepend(document.querySelector('video')!);
        const panel = root.querySelector<HTMLElement>('.bpx-player-ending-panel')!;
        const recorded = panel.innerHTML;
        panel.replaceChildren();
        const w = window as unknown as { host: Record<string, unknown> };
        // Bilibili fills the panel when the video ends, its first tile counting down while autoplay is on; part and
        // series switches never reach this panel.
        const host = { navigations: 0, show(countdown: boolean) {
          panel.innerHTML = recorded;
          for (const element of panel.querySelectorAll<HTMLElement>('.bpx-player-ending-related-item-cancel, .bpx-player-ending-related-item-countdown')) {
            element.style.display = countdown ? '' : 'none';
          }
        }, clear() { panel.replaceChildren(); } };
        w.host = host;
        // Delegated like the host: its own handlers, a SPA switch through pushState, the panel emptied.
        panel.addEventListener('click', event => {
          const target = event.target as HTMLElement;
          if (target.closest('.bpx-player-ending-related-item-cancel')) {
            event.stopPropagation();
            for (const element of panel.querySelectorAll<HTMLElement>('.bpx-player-ending-related-item-cancel, .bpx-player-ending-related-item-countdown')) {
              element.style.display = 'none';
            }
            return;
          }
          const tile = target.closest('.bpx-player-ending-related-item');
          if (!tile) return;
          host.navigations++;
          history.pushState({}, '', `/video/${bvids[[...panel.querySelectorAll('.bpx-player-ending-related-item')].indexOf(tile)]}/`);
          host.clear();
          document.querySelector('video')!.currentTime = 0;
        });
      }, ids);
      await bootPlayer(page, { mainWorld: true, bundle: bundlePlayer([
        "export { createBilibiliEndScreen } from './providers/bilibili/end-screen';",
        "export { readBilibiliEndTiles } from './providers/bilibili/end-screen-model';",
        "export { createBilibiliServiceActions } from './providers/bilibili/service-actions';",
        "export { serviceElementToken } from './providers/native-service-actions';"
      ]) });
      await page.waitForFunction(() => document.querySelector('video')!.readyState >= 2);
      await enterTheater(page);
      const host = (call: string) => page.evaluate(`window.host.${call}`);
      const end = async (countdown: boolean) => {
        await page.evaluate(async () => {
          const video = document.querySelector('video')!;
          video.currentTime = video.duration - 0.15;
          await video.play();
        });
        await page.waitForFunction(() => document.querySelector('video')!.ended);
        await host(`show(${countdown})`);
      };
      const tiles = page.locator('.theater-end-screen-tile');
      const curtain = page.locator('.theater-ended-curtain');

      const items = await page.evaluate<EndScreenItem[]>('TheaterTest.readBilibiliEndTiles(document.querySelector(".bpx-player-container"), document).map(entry => entry.item)');
      assert.deepEqual(items, []);
      await host('show(false)');
      const extracted = await page.evaluate<EndScreenItem[]>('TheaterTest.readBilibiliEndTiles(document.querySelector(".bpx-player-container"), document).map(entry => entry.item)');
      await host('clear()');
      assert.equal(extracted.length, 3, 'three of the four panel tiles');
      assert.equal(extracted[0].id, ids[0]);
      assert.match(extracted[0].durationText!, /^\d{1,2}(:\d{2}){1,2}$/);
      assert.ok(extracted[0].channel && extracted[0].meta, 'the sidebar card supplies the uploader and the views');
      assert.match(extracted[0].thumbnailUrl!, /^https:\/\/i\d\.hdslb\.com\//);

      // Autoplay on: Bilibili's countdown owns the picture. No curtain, no tiles; Play now and Cancel are the player's.
      await end(true);
      const play = page.locator('.theater-service-action').filter({ hasText: /^Next$/ });
      const cancel = page.locator('.theater-service-action').filter({ hasText: '取消连播' });
      await play.waitFor();
      await cancel.waitFor();
      assert.equal(await curtain.count(), 0);
      assert.equal(await tiles.count(), 0);
      // Cancelling goes through the host's own control; the media stays ended, so tiles take the picture.
      await cancel.click();
      await tiles.first().waitFor();
      assert.equal(await tiles.count(), 3);
      assert.equal(await page.locator('.theater-service-action').count(), 0);
      assert.equal(page.url(), url, 'cancelling does not navigate');
      const first = tiles.first();
      const name = await first.evaluate(button => button.textContent);
      assert.ok(name!.includes(extracted[0].title) && name!.includes(extracted[0].channel!) && name!.includes(extracted[0].durationText!));
      assert.equal(await first.locator('img').getAttribute('src'), extracted[0].thumbnailUrl);

      // The switch outlives its tiles and is independent of autoplay.
      const switchInput = page.locator('.theater-recommendations-setting input');
      await switchInput.click();
      await page.locator('.theater-end-screen').waitFor({ state: 'detached' });
      assert.deepEqual(await page.evaluate(async () => (await chrome.storage.sync.get('providerSettings')).providerSettings), { bilibili: { showRecommendations: false } });
      // The media stays ended: with the panel gone the plain curtain remains, and a new countdown takes over again.
      await host('clear()');
      await curtain.waitFor();
      await host('show(true)');
      await play.waitFor();
      assert.equal(await curtain.count(), 0, 'recommendations off does not bring the curtain over a countdown');
      await curtain.waitFor({ state: 'detached' });
      await host('show(false)');
      await curtain.waitFor();
      await switchInput.click();
      await tiles.first().waitFor();

      // Autoplay off (no countdown at all): the tiles show at once, and a tile uses Bilibili's own switch.
      await host('clear()');
      await tiles.first().waitFor({ state: 'detached' });
      await host('show(false)');
      await tiles.first().waitFor();
      await page.setViewportSize({ width: 640, height: 360 });
      assert.equal(await page.locator('.theater-end-screen').evaluate(grid => {
        const parent = grid.parentElement!.getBoundingClientRect();
        const box = grid.getBoundingClientRect();
        return box.left >= parent.left && box.right <= parent.right && box.top >= parent.top && box.bottom <= parent.bottom;
      }), true, 'the tiles stay within the picture after resize');
      await page.setViewportSize({ width: 1280, height: 720 });
      await tiles.nth(1).click();
      await page.waitForURL(`**/${ids[1]}/`);
      assert.equal(await page.evaluate('window.host.navigations'), 1);
      assert.equal(await page.locator('html.theater-everywhere-html-active').count(), 1, 'a SPA switch preserves theater');
      await page.locator('.theater-end-screen').waitFor({ state: 'detached' });
      await curtain.waitFor({ state: 'detached' });

      // Play now clicks Bilibili's own first tile once, however often it is pressed.
      await end(true);
      await play.waitFor();
      await play.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
      await page.waitForURL(`**/${ids[0]}/`);
      assert.equal(await page.evaluate('window.host.navigations'), 2);
      await page.locator('.theater-service-action').waitFor({ state: 'detached' });

      // A snapshot, tile and action kept across an A -> B -> A visit are stale; a click queued from the old mount does nothing.
      await end(false);
      await tiles.first().waitFor();
      assert.equal(await page.evaluate(`(async () => {
        const source = TheaterTest.createBilibiliEndScreen(document.querySelector('video'));
        await Promise.resolve();
        const stop = source.subscribe(() => {});
        const snapshot = source.read();
        const oldTile = document.querySelector('#theater-everywhere-ui').shadowRoot.querySelector('.theater-end-screen-tile');
        history.pushState({}, '', '/video/BV1xx411c7mu/'); history.pushState({}, '', location.pathname.replace('BV1xx411c7mu', '${ids[0]}'));
        oldTile.click();
        const rejected = !source.activate(snapshot.items[0].id, snapshot.mediaId);
        stop(); source.dispose(); source.dispose();
        return rejected;
      })()`), true);
      assert.equal(await page.evaluate('window.host.navigations'), 2, 'nothing navigated');

      // Replaying or a seek back empties the host's panel and the curtain goes with it.
      await host('clear()');
      await page.evaluate(() => { document.querySelector('video')!.currentTime = 0; });
      await curtain.waitFor({ state: 'detached' });

      // A multi-part or series item that follows switches within the curtain's delay: the curtain never appears. A later
      // unattended end proves it, as the only curtain ever added to the player UI.
      await page.evaluate(() => {
        const w = window as unknown as { curtains: number };
        w.curtains = 0;
        new MutationObserver(records => {
          for (const record of records) for (const node of record.addedNodes) {
            if (node instanceof Element && node.matches('.theater-ended-curtain')) w.curtains++;
          }
        }).observe(document.querySelector('#theater-everywhere-ui')!.shadowRoot!, { childList: true, subtree: true });
      });
      await page.evaluate(async () => {
        const video = document.querySelector('video')!;
        video.currentTime = video.duration - 0.15;
        await video.play();
        video.dispatchEvent(new Event('emptied'));
        video.currentTime = 0;
      });
      // The host leaving the end unattended (no panel, no switch): the plain curtain, with no tiles.
      await page.evaluate(async () => {
        const video = document.querySelector('video')!;
        video.currentTime = video.duration - 0.15;
        await video.play();
      });
      await curtain.waitFor();
      assert.equal(await tiles.count(), 0);
      assert.equal(await page.evaluate('window.curtains'), 1);
      await page.evaluate(() => { document.querySelector('video')!.currentTime = 0; });
      await curtain.waitFor({ state: 'detached' });

      // RTE off: the generic curtain, whatever the panel holds.
      await end(false);
      await tiles.first().waitFor();
      await page.evaluate(() => document.documentElement.setAttribute('data-te-bilibili-integration-off', ''));
      await page.locator('.theater-end-screen').waitFor({ state: 'detached' });
      assert.equal(await curtain.count(), 1);
      await page.locator('.close-btn').click();
      assert.equal(await page.locator('.theater-ended-curtain, .theater-service-action').count(), 0);
    });
  }
});
