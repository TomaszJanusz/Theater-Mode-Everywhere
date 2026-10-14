import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { it } from 'node:test';
import type { Page } from 'playwright';
import { ownTestBrowser } from '../test-utils/test-browser';
import type { ChromeRefs } from './runtime-context';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild') as { buildSync(options: object): { outputFiles: Array<{ text: string }> } };
const BUNDLE = esbuild.buildSync({
  stdin: {
    // Only discovery reads run here; the real refs preserve WeakRef semantics.
    contents: `import { createDiscovery } from './ui/discovery';
      import { createChromeRefs, type PlayerChromeContext } from './ui/runtime-context';
      export function createProbe() {
        const refs = createChromeRefs();
        const discovery = createDiscovery({ refs } as PlayerChromeContext);
        return { refs, findBestVideo: discovery.findBestVideo, findAllVideosDeep: discovery.findAllVideosDeep };
      }`,
    resolveDir: new URL('../', import.meta.url).pathname, loader: 'ts'
  },
  bundle: true, write: false, format: 'iife', globalName: 'DiscoveryTest',
  platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;
const MEDIA = `data:video/webm;base64,${readFileSync(new URL('../../test/fixtures/vod.webm', import.meta.url)).toString('base64')}`;

type Probe = {
  refs: ChromeRefs;
  findBestVideo(): HTMLVideoElement | null;
  findAllVideosDeep(): HTMLVideoElement[];
};

declare global {
  interface Window {
    DiscoveryTest: { createProbe(): Probe };
    discoveryProbe: Probe;
  }
}

async function setup(page: Page, html: string): Promise<void> {
  await page.setContent(`<style>body { margin: 0; } video { position: absolute; }</style>${html}`);
  await page.addScriptTag({ content: 'window.__name = target => target;' });
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(media => {
    window.discoveryProbe = window.DiscoveryTest.createProbe();
    for (const video of window.discoveryProbe.findAllVideosDeep()) {
      video.src = media;
      video.muted = true;
      video.loop = true;
      video.preload = 'auto';
    }
  }, MEDIA);
  await page.waitForFunction(() => window.discoveryProbe.findAllVideosDeep().every(video => video.readyState > 2));
}

async function rank(page: Page) {
  return page.evaluate(() => {
    const rect: Record<string, number> = {};
    const offsetWidth: Record<string, number> = {};
    const offsetHeight: Record<string, number> = {};
    const restores: Array<() => void> = [];
    for (const video of window.discoveryProbe.findAllVideosDeep()) {
      rect[video.id] = offsetWidth[video.id] = offsetHeight[video.id] = 0;
      const original = video.getBoundingClientRect;
      video.getBoundingClientRect = () => { rect[video.id]++; return original.call(video); };
      restores.push(() => { Reflect.deleteProperty(video, 'getBoundingClientRect'); });
      for (const [name, counts] of [['offsetWidth', offsetWidth], ['offsetHeight', offsetHeight]] as const) {
        const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)!;
        Object.defineProperty(video, name, { configurable: true, get() {
          counts[video.id]++;
          return original.get!.call(video);
        } });
        restores.push(() => { Reflect.deleteProperty(video, name); });
      }
    }
    try {
      return { picked: window.discoveryProbe.findBestVideo()?.id ?? null, rect, offsetWidth, offsetHeight };
    } finally {
      for (const restore of restores) restore();
    }
  });
}

for (const engine of ['chromium', 'firefox'] as const) {
  it(`${engine}: generic ranking reads each candidate once per sort`, { timeout: 60_000 }, async t => {
    const browser = await (await import('playwright'))[engine].launch({ headless: true });
    ownTestBrowser(t, browser);
    for (const count of [1, 4, 12]) {
      await t.test(`${count} candidates preserve the geometric choice and bound rect reads`, async () => {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await setup(page, Array.from({ length: count }, (_, i) => `<video id="v${i}" style="left:${(i * 173) % 900}px;top:${(i * 91) % 550}px;width:${100 + (i * 73) % 450}px;height:${100 + (i * 53) % 250}px"></video>`).join(''));
        const result = await rank(page);
        assert.equal(result.picked, count === 1 ? 'v0' : 'v3');
        // Eligibility has its own rect read; a singleton never enters the sort.
        assert.deepEqual(Object.values(result.rect), Array(count).fill(count === 1 ? 1 : 2));
        assert.deepEqual(Object.values(result.offsetWidth), Array(count).fill(0));
        assert.deepEqual(Object.values(result.offsetHeight), Array(count).fill(0));
        await page.close();
      });
    }

    await t.test('offscreen fallback caches layout area and retains playing/pointer priority', async () => {
      const page = await browser.newPage();
      await setup(page, Array.from({ length: 12 }, (_, i) => `<video id="v${i}" style="left:2000px;top:0;width:${100 + i * 10}px;height:100px;transform:scale(${12 - i})"></video>`).join(''));
      const result = await rank(page);
      // Transformed rect area favors v0; the fallback must use offset dimensions.
      assert.equal(result.picked, 'v11');
      assert.deepEqual(Object.values(result.rect), Array(12).fill(2));
      assert.deepEqual(Object.values(result.offsetWidth), Array(12).fill(1));
      assert.deepEqual(Object.values(result.offsetHeight), Array(12).fill(1));
      await page.evaluate(() => { window.discoveryProbe.refs.activeVideo = document.querySelector('video'); });
      assert.equal((await rank(page)).picked, 'v0');
      await page.locator('#v1').evaluate((video: HTMLVideoElement) => video.play());
      assert.equal((await rank(page)).picked, 'v1');
      await page.close();
    });

    await t.test('each ranking refreshes resize, scroll and playback metrics', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await setup(page, '<video id="wide" style="left:560px;top:360px;width:320px;height:180px"></video><video id="small" style="left:0;top:0;width:320px;height:180px"></video><div style="height:3000px"></div>');
      const expectRank = async (picked: string) => {
        const result = await rank(page);
        assert.equal(result.picked, picked);
        assert.deepEqual(result.rect, { wide: 2, small: 2 });
      };
      await expectRank('wide');
      await page.setViewportSize({ width: 320, height: 180 });
      await expectRank('small');
      await page.setViewportSize({ width: 1440, height: 900 });
      await expectRank('wide');
      await page.evaluate(() => window.scrollTo(0, 600));
      await page.waitForFunction(() => window.scrollY === 600);
      await expectRank('wide'); // Both offscreen, tied offset area: stable DOM order.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForFunction(() => window.scrollY === 0);
      await page.locator('#small').evaluate((video: HTMLVideoElement) => video.play());
      await expectRank('small');
      await page.locator('#small').evaluate((video: HTMLVideoElement) => video.pause());
      await expectRank('wide');
      await page.close();
    });

    await t.test('shadow candidates, viewport priority and detached WeakRef remain valid', async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await setup(page, '<video id="center" style="left:560px;top:360px;width:320px;height:180px"></video><video id="pointed" style="left:0;top:0;width:320px;height:180px"></video>');
      await page.evaluate(() => {
        const host = document.createElement('div');
        document.body.append(host);
        const pointed = document.getElementById('pointed') as HTMLVideoElement;
        pointed.style.position = 'absolute';
        host.attachShadow({ mode: 'open' }).append(pointed);
        window.discoveryProbe.refs.activeVideo = pointed;
      });
      assert.equal((await rank(page)).picked, 'pointed');
      await page.locator('#center').evaluate((video: HTMLVideoElement) => video.play());
      assert.equal((await rank(page)).picked, 'center');
      await page.locator('#center').evaluate((video: HTMLVideoElement) => video.pause());
      await page.locator('#pointed').evaluate((video: HTMLVideoElement) => { video.style.left = '2000px'; return video.play(); });
      assert.equal((await rank(page)).picked, 'center', 'viewport beats offscreen playback and pointer');
      await page.locator('#pointed').evaluate(video => video.remove());
      assert.equal((await rank(page)).picked, 'center');
      assert.equal(await page.evaluate(() => window.discoveryProbe.refs.activeVideo), null);
      await page.close();
    });
  });
}
