import { readStylesheet } from '../test-utils/styles';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { clockLabels } from './time-readout';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readStylesheet(path.join(SRC, 'content.css'));

function slots(text: string): string {
  return [...text].map((ch) => {
    const kind = ch === ':' ? ' is-sep' : (ch >= '0' && ch <= '9' ? '' : ' is-sign');
    const shown = ch === ' ' ? '' : ch
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;');
    return `<span class="theater-time-slot${kind}"><span class="theater-time-glyph">${shown}</span></span>`;
  }).join('');
}

describe('split time readout', () => {
  it('keeps the scrubber still while digits and the duration toggle change', async () => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) return;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 400 } });
      await page.setContent(`<div class="theater-controls-wrapper visible">
        <div class="theater-controls-row">
          <div class="theater-controls-left">
            <button class="theater-control-btn" type="button"></button>
            <span id="elapsed" class="theater-time-display theater-time-elapsed" dir="ltr"></span>
          </div>
          <div id="scrubber" class="theater-scrubber-container"><div class="theater-scrubber-track"></div></div>
          <div class="theater-controls-right">
            <button id="end" class="theater-time-display theater-time-end" type="button"></button>
            <button class="theater-control-btn" type="button"></button>
          </div>
        </div>
      </div>`);
      await page.addStyleTag({ content: CSS });

      const end = 2 * 3600 + 15 * 60;
      const frames = [
        clockLabels(0, end, false),
        clockLabels(59, end, false),
        clockLabels(3600, end, false),
        clockLabels(end - 1, end, false),
        clockLabels(end - 1, end, true)
      ];
      const measure = async (labels: { elapsed: string; edge: string }) => {
        await page.locator('#elapsed').evaluate((el, html) => { el.innerHTML = html; }, slots(labels.elapsed));
        await page.locator('#end').evaluate((el, html) => { el.innerHTML = html; }, slots(labels.edge));
        return await page.evaluate(`(() => {
          const box = (id) => {
            const rect = document.querySelector(id).getBoundingClientRect();
            return { x: rect.x, w: rect.width };
          };
          const scrubber = box('#scrubber');
          const elapsed = box('#elapsed');
          const edge = box('#end');
          return {
            scrubberX: Math.round(scrubber.x * 100) / 100,
            scrubberW: Math.round(scrubber.w * 100) / 100,
            elapsedRight: Math.round((elapsed.x + elapsed.w) * 100) / 100,
            edgeX: Math.round(edge.x * 100) / 100,
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
});
