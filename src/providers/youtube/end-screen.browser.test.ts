import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { chromium, firefox } from 'playwright';

import { bootPlayer, bundlePlayer, enterTheater } from '../../test-utils/player-boot';
import { readStylesheet } from '../../test-utils/styles';
import { sharedTestBrowser } from '../../test-utils/test-browser';
import { testEngines } from '../../test-utils/test-engines';
import { serveFixture, vodVideoFixture } from '../../test-utils/video-fixtures';
import type { EndScreenItem } from '../end-screen-view';

const recorded = readFileSync(new URL('../../../test/host-fixtures/youtube-end-screen.html', import.meta.url), 'utf8');
const url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const fixture = vodVideoFixture({ title: 'End-screen fixture' }).replace('<body>',
  '<body><ytd-watch-flexy video-id="jNQXAC9IVRw">' + recorded).replace('</body>', '</ytd-watch-flexy></body>');

describe('YouTube end tiles (recorded DOM fixture, not live host evidence)', () => {
  for (const engine of testEngines()) {
    const browser = sharedTestBrowser(({ chromium, firefox })[engine]);
    it(`end-only display, native SPA activation, stale visits, autoplay, RTE and cleanup in ${engine}`, { timeout: 60_000 }, async t => {
      const page = await (await browser.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      page.setDefaultTimeout(8000);
      await serveFixture(page, fixture, url);
      // The recorded URLs remain intact; fixture checks never contact the thumbnail CDN.
      await page.route('https://*.ytimg.com/**', route => route.fulfill({ contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#334155"/></svg>' }));
      await page.evaluate(() => {
        const player = document.querySelector('#movie_player')!;
        const video = document.querySelector('video')!;
        player.prepend(video);
        player.classList.remove('ended-mode');
        // The fixture uses YouTube's native links but supplies a deterministic host SPA handler.
        for (const anchor of player.querySelectorAll<HTMLAnchorElement>('a')) anchor.addEventListener('click', event => {
          event.preventDefault();
          document.dispatchEvent(new Event('yt-navigate-start', { bubbles: true }));
          history.pushState({}, '', anchor.href);
          document.querySelector('ytd-watch-flexy')!.setAttribute('video-id', new URL(anchor.href).searchParams.get('v')!);
          player.classList.remove('ended-mode');
          video.currentTime = 0;
          document.dispatchEvent(new Event('yt-navigate-finish', { bubbles: true }));
        });
      });
      await bootPlayer(page, { mainWorld: true, bundle: bundlePlayer([
        "export { createYouTubeEndScreen } from './providers/youtube/end-screen';",
        "export { readYouTubeSuggestions } from './providers/youtube/end-screen-model';",
        "import { openProviderSettings } from '../options/provider-settings';",
        "import { createYouTubeSettings } from './providers/youtube/settings';",
        "import { PROVIDER_SETTINGS } from './providers/catalog';",
        "export async function openRecommendations() { const store = createYouTubeSettings(); await store.ready; const modal = openProviderSettings({ ...PROVIDER_SETTINGS.find(p => p.id === 'youtube'), name: 'YouTube' }, store); modal.closed.then(() => store.dispose()); }"
      ]) });
      await page.waitForFunction(() => document.querySelector('video')!.readyState >= 2);
      await enterTheater(page);
      assert.equal(await page.locator('.theater-end-screen-tile').count(), 0, 'pause never shows tiles even with an ended-mode host fixture');
      const extracted = await page.evaluate<EndScreenItem[]>('TheaterTest.readYouTubeSuggestions(document).map(entry => entry.item)');
      assert.equal(extracted.length, 3);
      assert.equal(extracted[0].channel, 'Wojan PLUS');
      assert.equal(extracted[0].durationText, '18:06');
      assert.equal(extracted[0].thumbnailUrl, 'https://i1.ytimg.com/vi/YQ8wOO9bvps/hqdefault.jpg');
      const end = async () => {
        await page.evaluate(async () => {
          document.querySelector('#movie_player')!.classList.add('ended-mode');
          const video = document.querySelector('video')!;
          video.currentTime = video.duration - 0.15;
          await video.play();
        });
        await page.locator('.theater-end-screen-tile').first().waitFor();
      };
      await end();
      assert.equal(await page.locator('.theater-end-screen-tile').count(), 3);
      const switchInput = page.locator('.theater-recommendations-setting input');
      await switchInput.click();
      await page.locator('.theater-end-screen').waitFor({ state: 'detached' });
      assert.equal(await page.locator('.theater-ended-curtain').count(), 1);
      assert.equal(await switchInput.isVisible(), true);
      assert.deepEqual(await page.evaluate(async () => (await chrome.storage.sync.get('providerSettings')).providerSettings), { youtube: { showRecommendations: false } });
      // The options content is production code against the same extension storage edge.
      await page.addStyleTag({ content: readStylesheet(new URL('../../../options/options.css', import.meta.url)) });
      await page.evaluate('TheaterTest.openRecommendations()');
      const modalSwitch = page.locator('.te-dialog-provider-settings').getByRole('switch', { name: 'Show recommendations', exact: true });
      assert.equal(await modalSwitch.isChecked(), false);
      await modalSwitch.press('Space');
      await page.locator('.theater-end-screen-tile').first().waitFor();
      await page.keyboard.press('Escape');
      await page.locator('.te-dialog-overlay').waitFor({ state: 'detached' });
      await switchInput.focus();
      await page.keyboard.press('Space');
      await page.locator('.theater-end-screen').waitFor({ state: 'detached' });
      assert.equal(await switchInput.evaluate(input => (input.getRootNode() as ShadowRoot).activeElement === input), true);
      await page.keyboard.press('Space');
      await page.locator('.theater-end-screen-tile').first().waitFor();
      await page.locator('.fullscreen-btn').click();
      await page.waitForFunction(() => Boolean(document.fullscreenElement));
      assert.equal(await page.locator('.theater-end-screen-tile').first().isVisible(), true, 'tiles stay visible in fullscreen');
      await page.locator('.fullscreen-btn').click();
      await page.waitForFunction(() => !document.fullscreenElement);
      await page.locator('.player-settings-btn').click();
      await page.locator('.theater-settings-menu.visible').waitFor();
      assert.equal(await page.locator('.theater-settings-menu').evaluate(menu => {
        const box = menu.getBoundingClientRect();
        const root = menu.getRootNode() as ShadowRoot;
        return menu.contains(root.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
      }), true, 'the menu paints above the provider tiles');
      await page.locator('.player-settings-btn').click();
      await page.setViewportSize({ width: 640, height: 360 });
      assert.equal(await page.locator('.theater-end-screen').evaluate(grid => {
        const parent = grid.parentElement!.getBoundingClientRect();
        const box = grid.getBoundingClientRect();
        return box.left >= parent.left && box.right <= parent.right && box.top >= parent.top && box.bottom <= parent.bottom;
      }), true, 'the tiles stay within the picture after resize');
      await page.setViewportSize({ width: 1280, height: 720 });
      // A snapshot and anchor retained across an A -> B -> A visit are still stale.
      assert.equal(await page.evaluate(`(async () => {
        const source = TheaterTest.createYouTubeEndScreen(document.querySelector('video'));
        await Promise.resolve();
        const stop = source.subscribe(() => {});
        const snapshot = source.read();
        const oldTile = document.querySelector('#theater-everywhere-ui').shadowRoot.querySelector('.theater-end-screen-tile');
        document.dispatchEvent(new Event('yt-navigate-start'));
        document.dispatchEvent(new Event('yt-navigate-finish'));
        oldTile.click();
        const rejected = !source.activate(snapshot.items[0].id, snapshot.mediaId);
        stop(); source.dispose(); source.dispose();
        return rejected;
      })()`), true);
      assert.equal(page.url(), url, 'a click queued from the old mount cannot navigate');
      await page.locator('.theater-end-screen-tile').first().waitFor();
      await page.locator('.theater-end-screen-tile').first().click();
      await page.waitForURL('**v=YQ8wOO9bvps');
      assert.equal(await page.locator('html.theater-everywhere-html-active').count(), 1, 'native fixture SPA navigation preserves theater');
      await page.locator('.theater-end-screen').waitFor({ state: 'detached' });
      // Exercise the real runtime's keyboard capture in both worlds, not just native button behavior.
      for (const [key, id, index] of [['Enter', 'rXnu-4_vDaY', 1], ['Space', 'YQ8wOO9bvps', 0]] as const) {
        await end();
        await page.locator('.theater-end-screen-tile').nth(index).focus();
        await page.keyboard.press(key);
        await page.waitForURL(`**v=${id}`);
        assert.equal(await page.locator('html.theater-everywhere-html-active').count(), 1, `${key} keeps theater active`);
        await page.locator('.theater-end-screen').waitFor({ state: 'detached' });
      }
      await end();
      await page.evaluate(() => document.documentElement.setAttribute('data-te-youtube-integration-off', ''));
      await page.locator('.theater-end-screen').waitFor({ state: 'detached' });
      assert.equal(await page.locator('.theater-ended-curtain').count(), 1, 'RTE off keeps the generic curtain');
      await page.locator('.close-btn').click();
      assert.equal(await page.locator('.theater-ended-curtain').count(), 0);
      await page.evaluate(() => document.dispatchEvent(new Event('yt-navigate-finish')));
      assert.equal(await page.locator('.theater-end-screen').count(), 0);
    });
  }
});
