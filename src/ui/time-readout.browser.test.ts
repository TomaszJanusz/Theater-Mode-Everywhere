import { readStylesheet } from '../test-utils/styles';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import type { Page } from 'playwright';
import { clockLabels } from './time-readout';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readStylesheet(path.join(SRC, 'content.css'));
const require = createRequire(import.meta.url);
const esbuild = require(createRequire(require.resolve('vite')).resolve('esbuild')) as {
  buildSync(options: Record<string, unknown>): { outputFiles: Array<{ text: string }> };
};
const BUNDLE = esbuild.buildSync({
  entryPoints: [path.join(SRC, 'ui/time-readout.ts')],
  bundle: true, write: false, format: 'iife', globalName: 'TimeReadout', platform: 'browser', target: 'es2022'
}).outputFiles[0].text;

/** The player bar inside a shadow root carrying content.css, as the extension mounts it. */
async function mountBar(page: Page): Promise<void> {
  await page.setContent('<div id="theater-everywhere-ui"></div>');
  await page.addScriptTag({ content: `${BUNDLE}\nwindow.TimeReadout = TimeReadout;` });
  await page.evaluate(`(css => {
    const shadow = document.querySelector('#theater-everywhere-ui').attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    const bar = document.createElement('div');
    bar.innerHTML = \`<div class="theater-controls-wrapper visible">
      <div class="theater-controls-row">
        <div class="theater-controls-left">
          <button class="theater-control-btn" type="button"></button>
          <span id="elapsed" class="theater-time-display theater-time-elapsed" dir="ltr"></span>
        </div>
        <div id="scrubber" class="theater-scrubber-container"><div class="theater-scrubber-track"></div></div>
        <div class="theater-controls-right">
          <button id="end" class="theater-time-display theater-time-end" type="button" dir="ltr"></button>
          <button class="theater-control-btn" type="button"></button>
        </div>
      </div>
    </div>\`;
    shadow.append(style, bar.firstElementChild);
    window.paint = (elapsed, edge, animate) => {
      window.TimeReadout.renderTimeReadout(shadow.querySelector('#elapsed'), elapsed, animate);
      window.TimeReadout.renderTimeReadout(shadow.querySelector('#end'), edge, animate);
    };
    window.box = (id) => {
      const rect = shadow.querySelector(id).getBoundingClientRect();
      return { x: Math.round(rect.x * 100) / 100, w: Math.round(rect.width * 100) / 100 };
    };
  })(${JSON.stringify(CSS)})`);
}

describe('split time readout', () => {
  it('keeps the scrubber still while digits and the duration toggle change', async () => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) return;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 400 } });
      await mountBar(page);

      const end = 2 * 3600 + 15 * 60;
      const frames = [
        clockLabels(0, end, false),
        clockLabels(59, end, false),
        clockLabels(3600, end, false),
        clockLabels(end - 1, end, false),
        clockLabels(end - 1, end, true)
      ];
      const measure = async (labels: { elapsed: string; edge: string }) => {
        await page.evaluate(`window.paint(${JSON.stringify(labels.elapsed)}, ${JSON.stringify(labels.edge)}, false)`);
        return await page.evaluate(`(() => {
          const scrubber = window.box('#scrubber');
          const elapsed = window.box('#elapsed');
          const edge = window.box('#end');
          return {
            scrubberX: scrubber.x,
            scrubberW: scrubber.w,
            elapsedRight: elapsed.x + elapsed.w,
            edgeX: edge.x,
            order: elapsed.x < scrubber.x && scrubber.x + scrubber.w <= edge.x + 0.5
          };
        })()`) as {
          scrubberX: number;
          scrubberW: number;
          elapsedRight: number;
          edgeX: number;
          order: boolean;
        };
      };

      const first = await measure(frames[0]);
      assert.equal(first.order, true, JSON.stringify(first));
      for (const frame of frames.slice(1)) {
        const next = await measure(frame);
        assert.ok(Math.abs(next.scrubberX - first.scrubberX) < 0.6, JSON.stringify({ first, next, frame }));
        assert.ok(Math.abs(next.scrubberW - first.scrubberW) < 0.6, JSON.stringify({ first, next, frame }));
        assert.ok(Math.abs(next.elapsedRight - first.elapsedRight) < 0.6, JSON.stringify({ first, next, frame }));
        assert.ok(Math.abs(next.edgeX - first.edgeX) < 0.6, JSON.stringify({ first, next, frame }));
      }
    } finally {
      await browser.close();
    }
  });

  it('rolls a changed digit in the clock color and settles sharp', async () => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) return;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 400 } });
      await mountBar(page);
      await page.evaluate(`window.paint('1:23:45', '-0:36:15', false)`);
      const steadyScrubber = await page.evaluate(`window.box('#scrubber')`);
      await page.evaluate(`window.paint('1:23:46', '-0:36:14', true)`);

      type Glyph = { text: string; color: string; opacity: string; textShadow: string; filter: string; y: number };
      const sample = async (time: number) => await page.evaluate(`(() => {
        const shadow = document.querySelector('#theater-everywhere-ui').shadowRoot;
        for (const animation of shadow.getAnimations()) {
          animation.pause();
          animation.currentTime = ${time};
        }
        const glyphs = (id) => [...shadow.querySelectorAll(id + ' .theater-time-slot:last-child .theater-time-glyph')].map((glyph) => {
          const style = getComputedStyle(glyph);
          return {
            text: glyph.textContent,
            color: style.color,
            opacity: style.opacity,
            textShadow: style.textShadow,
            filter: style.filter,
            y: new DOMMatrixReadOnly(style.transform).m42
          };
        });
        return { elapsed: glyphs('#elapsed'), edge: glyphs('#end'), scrubber: window.box('#scrubber') };
      })()`) as { elapsed: Glyph[]; edge: Glyph[]; scrubber: { x: number; w: number } };
      const blur = (glyph: Glyph | undefined) => Number(glyph?.filter.match(/blur\(([\d.]+)px\)/)?.[1] ?? 0);

      for (const time of [0, 160, 320]) {
        const frame = await sample(time);
        const detail = JSON.stringify({ time, frame });
        assert.deepEqual(frame.scrubber, steadyScrubber, detail);
        for (const glyph of [...frame.elapsed, ...frame.edge]) {
          assert.equal(glyph.color, 'rgb(161, 161, 170)', detail);
          assert.equal(glyph.opacity, '1', detail);
          assert.equal(glyph.textShadow, 'none', detail);
        }
        const entering = frame.elapsed.find((glyph) => glyph.text === '6');
        if (time === 0) {
          assert.ok((entering?.y ?? 0) > 0, `elapsed counts up from below: ${detail}`);
          assert.ok((frame.edge.find((glyph) => glyph.text === '4')?.y ?? 0) < 0, `remaining counts down from above: ${detail}`);
        }
        if (time === 160) assert.ok(blur(entering) > 0.2 && blur(entering) < 1.2, `soft but readable: ${detail}`);
        if (time === 320) assert.equal(blur(entering), 0, detail);
      }

      await page.evaluate(`(() => {
        for (const animation of document.querySelector('#theater-everywhere-ui').shadowRoot.getAnimations()) animation.play();
        window.paint('1:23:47', '-0:36:13', true);
      })()`);
      const midway = await page.evaluate(`document.querySelector('#theater-everywhere-ui').shadowRoot
        .querySelectorAll('#elapsed .theater-time-slot:last-child .theater-time-glyph').length`);
      assert.equal(midway, 2, 'a fresh tick replaces the glyph still leaving');
      await page.waitForFunction(`!document.querySelector('#theater-everywhere-ui').shadowRoot
        .querySelector('.is-rolling, .is-entering, .is-leaving')`);
      const settled = await page.evaluate(`[...document.querySelector('#theater-everywhere-ui').shadowRoot
        .querySelectorAll('.theater-time-glyph')].map((glyph) => glyph.textContent).join('')`);
      assert.equal(settled, '1:23:47-0:36:13');
    } finally {
      await browser.close();
    }
  });
});
