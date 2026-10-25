import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sharedEngineBrowsers } from '../test-utils/engine-browsers';
import { playerStylesheets } from '../test-utils/player-boot';
import { testEngines } from '../test-utils/test-engines';

const UI_CSS = playerStylesheets().ui;
const browsers = sharedEngineBrowsers();

describe('player bar notch', () => {
  it('drops the open trigger onto the bar’s bottom border without moving the icon', async (t) => {
    const page = await (await browsers.chromium.newContext(t, { viewport: { width: 900, height: 400 } })).newPage();
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
    await page.addStyleTag({ content: UI_CSS });
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
  });
});

describe('caption menu notch', () => {
  const html = (dir: string, tracks: number) => `<div class="theater-controls-wrapper visible" dir="${dir}" style="position:fixed;left:40px;bottom:40px;width:640px">
    <div class="theater-controls-row"><div class="theater-controls-right" style="margin-left:300px">
      <div class="theater-cc-menu-host theater-menu-anchored theater-menu is-open">
        <button class="theater-control-btn" id="btn" type="button"><span>CC</span></button>
        <div class="theater-cc-menu visible" id="menu">
          <div class="theater-cc-menu-header"><span class="theater-cc-menu-title">Subtitles</span><button type="button" class="theater-cc-menu-options">Options</button></div>
          <div class="theater-cc-menu-list">${tracks === 0
            ? '<div class="theater-cc-menu-item">No subtitles</div>'
            : Array.from({ length: tracks }, (_, i) => `<button type="button" class="theater-cc-menu-item">Track ${i}</button>`).join('')}</div>
        </div>
      </div>
    </div></div></div>`;

  for (const engine of testEngines()) {
    it(`keeps the notch clear of the header and flush with the menu for any row count (${engine})`, async (t) => {
      const page = await (await browsers[engine].newContext(t, { viewport: { width: 900, height: 500 } })).newPage();
      for (const dir of ['ltr', 'rtl']) {
        for (const tracks of [0, 1, 30]) {
          await page.setContent(html(dir, tracks));
          await page.addStyleTag({ content: UI_CSS });
          const r = await page.evaluate(`(() => {
            const rect = (s) => document.querySelector(s).getBoundingClientRect();
            const menu = rect('#menu'), btn = rect('#btn'), header = rect('.theater-cc-menu-header');
            const overlap = parseFloat(getComputedStyle(document.querySelector('#menu')).getPropertyValue('--theater-menu-notch-overlap')) || 32;
            return {
              notchAboveMenuBottom: menu.bottom - btn.top,
              overlap,
              clearOfHeader: btn.top - header.bottom,
              edgeDelta: ${dir === 'rtl' ? 'Math.abs(menu.left - btn.left)' : 'Math.abs(menu.right - btn.right)'}
            };
          })()`) as { notchAboveMenuBottom: number; overlap: number; clearOfHeader: number; edgeDelta: number };
          const label = `${engine} ${dir} ${tracks}: ${JSON.stringify(r)}`;
          assert.ok(r.notchAboveMenuBottom <= r.overlap + 1, label);
          assert.ok(r.clearOfHeader >= 4, label);
          assert.ok(r.edgeDelta <= 1, label);
        }
      }
    });
  }
});
