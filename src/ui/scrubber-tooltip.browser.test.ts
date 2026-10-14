import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { build } from 'esbuild';
import type { Page } from 'playwright';
import type { MediaFeaturesController, TooltipMediaExtras } from '../media-features/controller';
import { ownTestBrowser } from '../test-utils/test-browser';
import { readStylesheet } from '../test-utils/styles';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readStylesheet(path.join(SRC, 'ui/shadow.css'));
const MEDIA = readFileSync(path.join(SRC, '../test/fixtures/vod.webm'));
const controls = readFileSync(path.join(SRC, 'ui/controls.ts'), 'utf8');
// Expose the real synchronous body so counters exclude unrelated runtime/dock frames.
assert.equal(controls.split('let tooltipFrame = 0;').length, 2);
const BUNDLE = build({
  stdin: {
    contents: [
      "export { bootstrapPlayerRuntime } from './ui/player-runtime';",
      "export { setPlayerUiCss } from './ui/root';",
      "export { MediaFeaturesController } from './media-features/controller';"
    ].join('\n'), resolveDir: SRC, loader: 'ts'
  },
  plugins: [{ name: 'scrubber-test-hook', setup(build) {
    build.onLoad({ filter: /\/ui\/controls\.ts$/ }, () => ({
      contents: controls.replace('let tooltipFrame = 0;',
        'Object.assign(window, { scrubberUpdateTooltip: updateTooltip });\n    let tooltipFrame = 0;')
        .replace('const updateTooltip = (clientX: number) => {',
          'const updateTooltip = (clientX: number) => { globalThis.scrubberUpdates++;'),
      loader: 'ts'
    }));
  } }],
  bundle: true, write: false, format: 'iife', globalName: 'ScrubberTest', platform: 'browser', target: 'es2022'
}).then(result => result.outputFiles![0].text);

declare global {
  interface Window {
    ScrubberTest: {
      bootstrapPlayerRuntime(): void;
      setPlayerUiCss(css: string): void;
      MediaFeaturesController: typeof MediaFeaturesController;
    };
    scrubberUpdateTooltip(clientX: number): void;
    scrubberExtras: TooltipMediaExtras;
    scrubberHeatmap: Array<number | null>;
    scrubberUpdates: number;
  }
}

const SPRITE = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="90">'
  + '<path fill="#384e6b" d="M0 0h160v90H0z"/><path fill="#c79955" d="M160 0h160v90H160z"/>'
  + '<path fill="#152638" d="m0 90 45-60 40 40 35-45 40 65z"/>'
  + '<path fill="#64412f" d="m160 90 45-60 40 40 35-45 40 65z"/></svg>'
);
function extras(chapterTitle = '', preview = false, x = 0): TooltipMediaExtras {
  return { chapterTitle, preview: preview ? {
    time: 0, width: 160, height: 90,
    image: { kind: 'sprite', url: SPRITE, x, y: 0, tileWidth: 160, tileHeight: 90, sheetWidth: 320, sheetHeight: 90 }
  } : null };
}

async function boot(page: Page): Promise<void> {
  await page.addInitScript('window.__name = fn => fn;');
  await page.route('http://scrubber.test/**', route => route.fulfill(
    route.request().url().endsWith('/vod.webm')
      ? { body: MEDIA, contentType: 'video/webm' }
      : { contentType: 'text/html', body: '<!doctype html><title>Scrubber fixture</title><style>body{margin:0;background:#111}video{width:960px;height:540px}</style><video muted src="/vod.webm"></video>' }
  ));
  await page.goto('http://scrubber.test/');
  await page.waitForFunction(() => document.querySelector('video')!.readyState >= 2);
  await page.evaluate(() => {
    Object.defineProperties(document.querySelector('video')!, {
      duration: { configurable: true, value: 3600 },
      currentTime: { configurable: true, writable: true, value: 1200 },
      buffered: { configurable: true, value: { length: 1, start: () => 0, end: () => 2400 } }
    });
    Object.assign(window, { chrome: { storage: {
      sync: { get: async () => ({ keepControlsVisible: true }), set: async () => {} },
      onChanged: { addListener() {} }
    } } });
    window.scrubberExtras = { chapterTitle: '', preview: null };
    window.scrubberHeatmap = [];
    window.scrubberUpdates = 0;
  });
  await page.addStyleTag({ content: CSS });
  await page.addScriptTag({ content: await BUNDLE });
  await page.evaluate(css => {
    const controller = window.ScrubberTest.MediaFeaturesController.prototype;
    controller.tooltipExtras = () => window.scrubberExtras;
    const hover = controller.setHeatmapHover;
    controller.setHeatmapHover = function (ratio) {
      window.scrubberHeatmap.push(ratio);
      hover.call(this, ratio);
    };
    window.ScrubberTest.setPlayerUiCss(css);
    window.ScrubberTest.bootstrapPlayerRuntime();
  }, CSS);
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
  await page.keyboard.press('t');
  await page.locator('.theater-controls-wrapper.visible').waitFor();
  await page.locator('#theater-everywhere-ui').evaluate(host => {
    const style = document.createElement('style');
    style.textContent = '* { transition: none !important; animation: none !important; }';
    host.shadowRoot!.append(style);
  });
}

async function paint(page: Page, value: TooltipMediaExtras, ratio = 0.5): Promise<void> {
  await page.evaluate(({ value, ratio }) => {
    window.scrubberExtras = value;
    const rect = document.getElementById('theater-everywhere-ui')!.shadowRoot!
      .querySelector('.theater-scrubber-container')!.getBoundingClientRect();
    window.scrubberUpdateTooltip(rect.left + rect.width * ratio);
  }, { value, ratio });
}

async function freezeClock(page: Page): Promise<void> {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
}

describe('scrubber tooltip', () => {
  it('captures time, chapter, sprite and edge positioning in Chromium', { timeout: 60_000 }, async t => {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    ownTestBrowser(t, browser);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await boot(page);
    for (const [name, value, ratio] of [
      ['time', extras(), 0.5], ['chapter', extras('Fixture chapter'), 0.5],
      ['preview-chapter', extras('Fixture chapter', true), 0.5],
      ['left', extras('Fixture chapter', true), 0], ['right', extras('Fixture chapter', true), 1]
    ] as const) {
      await paint(page, value, ratio);
      await page.locator('.theater-scrubber-tooltip.visible').waitFor();
      await page.waitForFunction(() => {
        const tip = document.getElementById('theater-everywhere-ui')!.shadowRoot!
          .querySelector('.theater-scrubber-tooltip')!;
        return getComputedStyle(tip).opacity === '1';
      });
      const rects = await page.locator('.theater-scrubber-tooltip').evaluate(tip => {
        const bar = tip.parentElement!.querySelector('.theater-scrubber-container')!.getBoundingClientRect();
        const rect = tip.getBoundingClientRect();
        return { center: rect.left + rect.width / 2, barLeft: bar.left, barWidth: bar.width };
      });
      assert.ok(Math.abs(rects.center - (rects.barLeft + ratio * rects.barWidth)) < 1);
      if (process.env.TME37_SCREENSHOTS) {
        mkdirSync(process.env.TME37_SCREENSHOTS, { recursive: true });
        // Await the exact background resource rather than an arbitrary paint delay.
        if (value.preview) await page.evaluate(async url => {
          const image = new Image(); image.src = url; await image.decode();
        }, value.preview.image.url);
        await page.screenshot({ path: path.join(process.env.TME37_SCREENSHOTS, `${name}.png`) });
      }
    }
  });

  for (const engine of ['chromium', 'firefox'] as const) {
    for (const [name, value] of [['time', extras()], ['preview + chapter', extras('Fixture chapter', true)]] as const) {
      it(`reuses ${name} nodes and reads geometry before writes in ${engine}`, { timeout: 60_000 }, async t => {
        const browser = await (await import('playwright'))[engine].launch({ headless: true });
        ownTestBrowser(t, browser);
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await boot(page);
        await freezeClock(page);
        await paint(page, value);
        const report = await page.evaluate(() => {
          const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
          const tip = root.querySelector<HTMLElement>('.theater-scrubber-tooltip')!;
          const bar = root.querySelector<HTMLElement>('.theater-scrubber-container')!;
          const row = root.querySelector<HTMLElement>('.theater-controls-row')!;
          const rect = bar.getBoundingClientRect();
          const initialChildren = [...tip.children];
          const observer = new MutationObserver(() => {});
          observer.observe(row, { attributes: true, childList: true, characterData: true, subtree: true });
          let create = 0, replace = 0, reads = 0, readsAfterWrites = 0;
          const createElement = document.createElement.bind(document);
          document.createElement = (...args: Parameters<typeof document.createElement>) => {
            create++; return createElement(...args);
          };
          const replaceChildren = tip.replaceChildren.bind(tip);
          tip.replaceChildren = (...nodes) => { replace++; replaceChildren(...nodes); };
          const anchors = [bar, row].map(element => ({ element, read: element.getBoundingClientRect.bind(element) }));
          for (const { element, read } of anchors) {
            element.getBoundingClientRect = () => {
              reads++;
              if (observer.takeRecords().length) readsAfterWrites++;
              return read();
            };
          }
          for (let i = 0; i < 120; i++) {
            observer.takeRecords();
            window.scrubberUpdateTooltip(rect.left + rect.width * (0.2 + i / 200));
          }
          const counts = { create, replace, reads, readsAfterWrites };
          observer.takeRecords();
          window.scrubberUpdateTooltip(rect.left + rect.width * 0.5);
          observer.takeRecords();
          window.scrubberUpdateTooltip(rect.left + rect.width * 0.5);
          const repeatedWrites = observer.takeRecords().filter(record => tip.contains(record.target)).length;
          document.createElement = createElement;
          tip.replaceChildren = replaceChildren;
          for (const { element, read } of anchors) element.getBoundingClientRect = read;
          observer.disconnect();
          return { ...counts, repeatedWrites,
            sameChildren: initialChildren.every((child, i) => tip.children[i] === child) };
        });
        assert.deepEqual(report, { create: 0, replace: 0, reads: 240, readsAfterWrites: 0,
          repeatedWrites: 0, sameChildren: true });
      });
    }

    it(`updates extras in place and cancels leave/reset/exit/replacement frames in ${engine}`, { timeout: 60_000 }, async t => {
      const browser = await (await import('playwright'))[engine].launch({ headless: true });
      ownTestBrowser(t, browser);
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await boot(page);
      await freezeClock(page);
      await paint(page, extras());
      const children = await page.locator('.theater-scrubber-tooltip').evaluateHandle(tip => [...tip.children]);
      const state = () => page.locator('.theater-scrubber-tooltip').evaluate(tip => {
        const preview = tip.querySelector<HTMLElement>('.theater-scrubber-preview')!;
        const chapter = tip.querySelector<HTMLElement>('.theater-scrubber-chapter-title')!;
        return { previewHidden: getComputedStyle(preview).display === 'none',
          chapterHidden: getComputedStyle(chapter).display === 'none',
          chapter: chapter.textContent, image: preview.style.backgroundImage,
          position: preview.style.backgroundPosition, height: tip.getBoundingClientRect().height };
      });
      const plain = await state();
      assert.ok(plain.previewHidden && plain.chapterHidden);
      await paint(page, extras('First chapter', true));
      const first = await state();
      assert.ok(!first.previewHidden && !first.chapterHidden && first.height > plain.height);
      await paint(page, extras('Second chapter', true, 160));
      assert.equal((await state()).chapter, 'Second chapter');
      assert.notEqual((await state()).position, first.position);
      const changed = extras('Third chapter', true);
      changed.preview!.image.url = SPRITE.replace('384e6b', '385e6b');
      changed.preview!.image.tileHeight = 60;
      await paint(page, changed);
      assert.notEqual((await state()).image, first.image);
      assert.ok((await state()).height < first.height);
      await paint(page, extras('Chapter only'));
      assert.ok((await state()).previewHidden && !(await state()).chapterHidden);
      await paint(page, extras());
      assert.equal((await state()).height, plain.height);
      assert.equal(await page.locator('.theater-scrubber-tooltip').evaluate((tip, nodes) =>
        nodes.every((node, i) => tip.children[i] === node), children), true);

      // Multiple events coalesce to the most recent pointer in one animation frame.
      await page.evaluate(() => { window.scrubberHeatmap = []; });
      for (const clientX of [400, 500, 600]) await page.locator('.theater-scrubber-container').dispatchEvent('mousemove', { clientX });
      assert.equal(await page.evaluate(() => window.scrubberHeatmap.length), 0);
      await page.clock.runFor(20);
      assert.equal(await page.evaluate(() => window.scrubberHeatmap.length), 1);
      const handle = await page.locator('.theater-scrubber-handle').evaluate(el => Number.parseFloat((el as HTMLElement).style.left));
      assert.ok(Math.abs(handle - (await page.evaluate(() => window.scrubberHeatmap[0]! * 100))) < 0.001);

      for (const action of ['leave', 'reset', 'replacement', 'exit'] as const) {
        const oldTip = await page.locator('.theater-scrubber-tooltip').elementHandle();
        assert.ok(oldTip);
        if (action === 'replacement') {
          await page.locator('video').evaluate(video => {
            const replacement = video.cloneNode(true) as HTMLVideoElement;
            replacement.id = 'replacement';
            Object.defineProperty(replacement, 'duration', { value: 3600 });
            video.after(replacement);
          });
          await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('#replacement')!.readyState >= 2);
        }
        await page.locator('.theater-scrubber-container').dispatchEvent('mousemove', { clientX: 700 });
        if (action === 'leave') await page.locator('.theater-scrubber-container').dispatchEvent('mouseleave');
        if (action === 'reset') await page.locator('video').dispatchEvent('emptied');
        if (action === 'replacement') {
          await page.evaluate(() => {
            document.querySelector('video:not(#replacement)')!.remove();
            // The real media event rebinds immediately, before the queued hover frame.
            document.querySelector('#replacement')!.dispatchEvent(new Event('loadedmetadata', { bubbles: true }));
          });
          assert.equal(await oldTip.evaluate(tip => tip.isConnected), false);
        }
        if (action === 'exit') await page.keyboard.press('t');
        await page.evaluate(() => { window.scrubberHeatmap = []; window.scrubberUpdates = 0; });
        await page.clock.runFor(40);
        assert.equal(await page.evaluate(() => window.scrubberUpdates), 0, action);
        assert.equal(await oldTip.evaluate(tip => tip.isConnected && tip.classList.contains('visible')), false, action);
        assert.ok((await page.evaluate(() => window.scrubberHeatmap)).every(value => value === null), action);
        await oldTip.dispose();
      }
      await children.dispose();
    });

    it(`preserves mouse seek, VOD/DVR/live clamps, fill and buffer in ${engine}`, { timeout: 60_000 }, async t => {
      const browser = await (await import('playwright'))[engine].launch({ headless: true });
      ownTestBrowser(t, browser);
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await boot(page);
      await freezeClock(page);
      const progress = () => page.evaluate(() => {
        const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
        const width = (selector: string) => Number.parseFloat(root.querySelector<HTMLElement>(selector)!.style.width);
        return { time: document.querySelector('video')!.currentTime,
          fill: width('.theater-scrubber-fill'), buffer: width('.theater-scrubber-buffer') };
      });
      assert.ok(Math.abs((await progress()).buffer - 100 * 2400 / 3600) < 0.001);
      for (const [mode, duration, start, end] of [
        ['vod', 3600, 0, 3600], ['dvr', Infinity, 1000, 2000]
      ] as const) {
        await page.locator('video').evaluate((video, { duration, start, end }) => {
          Object.defineProperties(video, {
            duration: { configurable: true, value: duration },
            seekable: { configurable: true, value: { length: 1, start: () => start, end: () => end } }
          });
          (video as HTMLVideoElement).currentTime = (start + end) / 2;
          video.dispatchEvent(new Event('durationchange'));
        }, { duration, start, end });
        const box = await page.locator('.theater-scrubber-container').boundingBox();
        assert.ok(box);
        await page.locator('.theater-scrubber-container').dispatchEvent('mousedown', { clientX: box.x - 20 });
        assert.equal((await progress()).time, start, `${mode} clamps below start`);
        await page.evaluate(({ x, y }) => document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y })),
          { x: box.x + box.width + 20, y: box.y + box.height / 2 });
        await page.evaluate(({ x, y }) => document.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y })),
          { x: box.x + box.width + 20, y: box.y + box.height / 2 });
        await page.locator('video').dispatchEvent('seeked');
        assert.equal((await progress()).time, end, `${mode} clamps beyond end`);
        assert.equal((await progress()).fill, 100);
        assert.equal(await page.locator('.theater-scrubber-container').evaluate(bar => bar.classList.contains('dragging')), false);
        await paint(page, extras(), 0.5);
        assert.equal(await page.locator('.theater-scrubber-time').textContent(), mode === 'vod' ? '0:30:00' : '-08:20');
        await paint(page, extras(), 1);
        assert.equal(await page.locator('.theater-scrubber-time').textContent(), mode === 'vod' ? '1:00:00' : 'LIVE');
      }
      await page.locator('.theater-scrubber-container').dispatchEvent('mouseleave');
      await page.locator('video').evaluate(video => {
        Object.defineProperty(video, 'seekable', { configurable: true, value: { length: 0 } });
        video.dispatchEvent(new Event('durationchange'));
      });
      const time = (await progress()).time;
      await page.locator('.theater-scrubber-container').dispatchEvent('mousedown', { clientX: 500 });
      await paint(page, extras());
      assert.equal((await progress()).time, time, 'non-DVR live does not seek');
      assert.equal((await progress()).buffer, 100);
      assert.equal(await page.locator('.theater-scrubber-tooltip').evaluate(tip => tip.classList.contains('visible')), false);
    });

    it(`keeps caption dock clear of tooltip extras after resize in ${engine}`, { timeout: 60_000 }, async t => {
      const browser = await (await import('playwright'))[engine].launch({ headless: true });
      ownTestBrowser(t, browser);
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await boot(page);
      await page.evaluate(() => {
        window.ScrubberTest.MediaFeaturesController.prototype.readHostCaptionLayout = () => ({ width: 500, height: 40, rows: 2, lineHeight: 20 });
      });
      const dock = () => page.evaluate(() => Number.parseFloat(document.documentElement.style.getPropertyValue('--theater-caption-bottom')));
      await paint(page, extras());
      await page.locator('.theater-scrubber-container').dispatchEvent('mouseleave');
      const base = await dock();
      await paint(page, extras('Fixture chapter', true));
      await page.waitForFunction(value => Number.parseFloat(document.documentElement.style.getPropertyValue('--theater-caption-bottom')) > value, base);
      for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
        await page.setViewportSize(viewport);
        await paint(page, extras('Fixture chapter', true));
        await page.waitForFunction(() => {
          const tip = document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-scrubber-tooltip')!.getBoundingClientRect();
          const bottom = Number.parseFloat(document.documentElement.style.getPropertyValue('--theater-caption-bottom'));
          return window.innerHeight - bottom <= tip.top - 11;
        });
      }
      const lifted = await dock();
      await page.locator('.theater-scrubber-container').dispatchEvent('mouseleave');
      await page.waitForFunction(value => Number.parseFloat(document.documentElement.style.getPropertyValue('--theater-caption-bottom')) < value, lifted);
    });
  }
});
