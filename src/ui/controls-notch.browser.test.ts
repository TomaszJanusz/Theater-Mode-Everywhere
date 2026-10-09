import { readStylesheet } from '../test-utils/styles';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readStylesheet(path.join(SRC, 'content.css'));

describe('player bar notch', () => {
  it('drops the open trigger onto the bar’s bottom border without moving the icon', async (t) => {
    const { chromium } = await import('playwright');
    let executable = '';
    try {
      executable = chromium.executablePath();
    } catch {
      t.skip('Chromium module or browser path is unavailable');
      return;
    }
    if (!existsSync(executable)) { t.skip('Chromium is not installed'); return; }
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 400 } });
      await page.setContent(`<div class="theater-controls-wrapper visible" style="position:fixed;left:40px;bottom:40px;width:640px">
        <div class="theater-controls-row">
          <div class="theater-controls-right">
            <button class="theater-control-btn" id="closed" type="button"><span>c</span></button>
            <div class="theater-settings-container theater-menu is-open">
              <button class="theater-control-btn" id="open" type="button"><span>o</span></button>
            </div>
          </div>
        </div>
      </div>`);
      await page.addStyleTag({ content: CSS });
      const report = await page.evaluate(`(() => {
        const bar = document.querySelector('.theater-controls-wrapper').getBoundingClientRect();
        const open = document.querySelector('#open').getBoundingClientRect();
        const closed = document.querySelector('#closed span').getBoundingClientRect();
        const gear = document.querySelector('#open span').getBoundingClientRect();
        const center = (rect) => rect.top + rect.height / 2;
        return {
          gap: Math.round((bar.bottom - open.bottom) * 10) / 10,
          iconDelta: Math.round((center(gear) - center(closed)) * 10) / 10
        };
      })()`) as { gap: number; iconDelta: number };
      assert.ok(Math.abs(report.gap) < 0.6, JSON.stringify(report));
      assert.ok(Math.abs(report.iconDelta) < 1, JSON.stringify(report));
    } finally {
      await browser.close();
    }
  });
});
