import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it, type TestContext } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { bootPlayer, bundleModules, enterTheater } from '../../test-utils/player-boot';
import { sharedTestBrowser } from '../../test-utils/test-browser';
import { testEngines } from '../../test-utils/test-engines';
import { serveFixture } from '../../test-utils/video-fixtures';

const navigationBundle = bundleModules(["export { readVikiControls } from './providers/viki/navigation';"], 'TeVikiNavigation');
const EPISODE_1 = 'https://www.viki.com/videos/1263131v';
const VOD = readFileSync(new URL('../../../test/fixtures/vod.webm', import.meta.url)).toString('base64');

/**
 * The measured shape of a Viki episode (Video.js 8 in the top document): the cue
 * display and the icon-only next-episode control sit inside `#vmplayer_id`, the
 * page title carries the episode and the VideoObject only the series. The next
 * control swaps the title like Viki's SPA does, and the player is rebuilt.
 */
const FIXTURE = `<!doctype html><html><head>
<title>Legend of the Female General - Episode 1 | Rakuten Viki</title>
<meta property="og:title" content="Legend of the Female General - Episode 1 | Rakuten Viki">
<meta property="og:site_name" content="Rakuten Viki">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoObject","name":"Legend of the Female General","embedUrl":"https://www.viki.com/player/1263131v"}</script>
<style>body { margin: 0; background: #111; } #vmplayer_id { position: relative; width: 960px; height: 540px; } video { width: 100%; height: 100%; }
.vjs-text-track-display { position: absolute; inset: 0; } .vjs-control-bar { position: absolute; bottom: 0; }</style></head>
<body><div class="video-player"><div id="vmplayer_id" class="video-js" tabindex="-1">
<video class="vjs-tech" muted playsinline src="data:video/webm;base64,${VOD}"></video>
<div class="vjs-text-track-display"><div style="position:absolute;inset:0;margin:1.5%"><div class="vjs-text-track-cue" style="position:absolute;bottom:2em;left:30%;font:16px sans-serif;color:#fff">Hello from Viki</div></div></div>
<div class="vjs-control-bar"><button type="button" class="vjs-control vjs-button" aria-disabled="false" title="Next episode"><span class="vjs-icon-next-item" aria-hidden="true"></span><span class="vjs-control-text">Next episode</span></button></div>
</div></div>
<script>
// Viki's player focuses itself from a timer once the pointer has left it.
window.vikiFocusTimer = () => document.getElementById('vmplayer_id').focus();
document.querySelector('.vjs-icon-next-item').parentElement.addEventListener('click', () => {
  history.pushState(null, '', '/videos/1263132v');
  document.title = 'Legend of the Female General - Episode 2 | Rakuten Viki';
  document.querySelector('meta[property="og:title"]').content = document.title;
});
</script></body></html>`;

async function open(page: Page, settings: Record<string, unknown> = {}): Promise<void> {
  await serveFixture(page, FIXTURE, EPISODE_1);
  await bootPlayer(page, { settings });
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return Boolean(video && video.readyState >= 2 && Number.isFinite(video.duration));
  });
  await page.evaluate(() => { document.querySelector('video')!.pause(); });
}

const cue = (page: Page) => page.evaluate(() => {
  const display = document.querySelector<HTMLElement>('.vjs-text-track-display')!;
  const rect = document.querySelector('.vjs-text-track-cue')!.getBoundingClientRect();
  return {
    position: getComputedStyle(display).position,
    stage: document.documentElement.classList.contains('theater-everywhere-viki-stage'),
    inViewport: rect.top >= 0 && rect.bottom <= innerHeight && rect.height > 0
  };
});

describe('Rakuten Viki provider', () => {
  for (const engine of testEngines()) {
    const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
    const newPage = async (t: TestContext, settings?: Record<string, unknown>) => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      await open(page, settings);
      return page;
    };

    it(`keeps the generic overlay launcher, since Viki declares no toolbar slot, in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await newPage(t, { videoActivator: true });
      await page.mouse.move(2, 2);
      await page.mouse.move(400, 260);
      const launcher = page.locator('.theater-video-activator');
      await launcher.waitFor();
      assert.equal(await launcher.getAttribute('aria-label'), 'Enter theater mode');
      // 12 px inset from the video's left edge; the fixture video sits at the page origin.
      assert.equal(await launcher.evaluate(button => (button as HTMLElement).offsetLeft), 12);
    });

    it(`names the episode, lifts host captions above the picture and restores them on exit in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await newPage(t);
      assert.equal((await cue(page)).stage, false);
      await enterTheater(page);
      await page.locator('.theater-title-hud-text', { hasText: 'Legend of the Female General - Episode 1' }).first().waitFor();
      assert.deepEqual(await cue(page), { position: 'fixed', stage: true, inViewport: true });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
      assert.deepEqual(await cue(page), { position: 'absolute', stage: false, inViewport: true });
    });

    it(`keeps an open player menu when Viki's player takes focus, and gives the player its tabindex back on exit, in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await newPage(t);
      const tabindex = () => page.evaluate(() => document.getElementById('vmplayer_id')!.getAttribute('tabindex'));
      await enterTheater(page);
      assert.equal(await tabindex(), null, 'the player cannot take focus in theater');
      await page.locator('.player-settings-btn').click();
      await page.locator('.audio-track-btn, .picture-layout-btn [data-direction="1"]').first().focus();
      const open = () => page.evaluate(() => document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-settings-container')!.classList.contains('is-open'));
      assert.equal(await open(), true);
      await page.evaluate(() => (window as unknown as { vikiFocusTimer(): void }).vikiFocusTimer());
      assert.equal(await open(), true, "Viki's focus call no longer leaves the menu");
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
      assert.equal(await tabindex(), '-1', 'restored on exit');
      assert.equal(await page.evaluate(() => document.querySelector('[data-te-viki-tabindex]')), null);
    });

    it(`steps to the next episode through Viki's own control and follows its title in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await newPage(t);
      await enterTheater(page);
      await page.locator('.playlist-next-btn').click();
      await page.waitForFunction(() => location.pathname === '/videos/1263132v');
      await page.locator('.theater-title-hud-text', { hasText: 'Episode 2' }).first().waitFor();
    });

    it(`keeps native caption presentation and the page title with the integration off, and reads the next control only while it is on in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await newPage(t, { vikiIntegrationEnabled: false });
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-te-viki-integration-off'));
      await enterTheater(page);
      await page.locator('.theater-title-hud-text', { hasText: 'Episode 1' }).first().waitFor();
      assert.deepEqual(await cue(page), { position: 'fixed', stage: true, inViewport: true });
      await page.addScriptTag({ content: navigationBundle });
      const controls = () => page.evaluate(() => (window as unknown as { TeVikiNavigation: { readVikiControls(root: ParentNode): unknown[] } })
        .TeVikiNavigation.readVikiControls(document).length);
      assert.equal(await controls(), 0, 'integration off');
      await page.evaluate(() => document.documentElement.removeAttribute('data-te-viki-integration-off'));
      assert.equal(await controls(), 1, 'integration on');
      await page.evaluate(() => document.querySelector('.vjs-icon-next-item')!.remove());
      assert.equal(await controls(), 0, 'no next control on the last episode');
    });
  }
});
