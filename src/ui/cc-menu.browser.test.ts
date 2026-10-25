import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chromium } from 'playwright';

import { bundleModules, playerStylesheets } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';

const POPOVER = bundleModules(["export { bindMenuPopover } from './ui/menu-popover';"], 'PopoverTest');
const UI_CSS = playerStylesheets().ui;

describe('caption language menu', () => {
  const shared = sharedTestBrowser(chromium);

  it('keeps scrolled language rows below the title bar', async (t) => {
    const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 800 } })).newPage();
    await page.setContent('<div class="theater-controls-wrapper" style="position:fixed;left:700px;bottom:24px"><div class="theater-cc-menu-host theater-menu-anchored is-open"><div class="theater-cc-menu visible"><div class="theater-cc-menu-header"><span class="theater-cc-menu-title">Napisy</span><button type="button" class="theater-cc-menu-options">Opcje</button></div><div class="theater-cc-menu-list"></div></div></div></div>');
    await page.addStyleTag({ content: UI_CSS });
    const report = await page.evaluate(`(() => {
      const list = document.querySelector('.theater-cc-menu-list');
      for (let i = 0; i < 40; i += 1) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'theater-control-btn theater-settings-row theater-cc-menu-item';
        item.textContent = 'język ' + i + ' angielski';
        list.append(item);
      }
      list.scrollTop = list.scrollHeight;
      const header = document.querySelector('.theater-cc-menu-header').getBoundingClientRect();
      const menu = document.querySelector('.theater-cc-menu').getBoundingClientRect();
      const probe = (y) => {
        const hit = document.elementFromPoint(Math.min(innerWidth - 8, Math.max(8, header.left + header.width / 2)), y);
        const item = hit && hit.closest('.theater-cc-menu-item');
        if (item) return 'item:' + item.textContent;
        if (hit && hit.closest('.theater-cc-menu-header')) return 'header';
        return hit && hit.className || null;
      };
      return {
        scrolls: list.scrollHeight > list.clientHeight + 8,
        above: probe(Math.max(menu.top + 1, header.top - 1)),
        title: probe(header.top + header.height / 2),
        gap: Math.round((header.top - menu.top) * 10) / 10
      };
    })()`) as { scrolls: boolean; above: string | null; title: string; gap: number };
    assert.equal(report.scrolls, true, JSON.stringify(report));
    assert.equal(String(report.above).startsWith('item:'), false, JSON.stringify(report));
    assert.equal(report.title, 'header', JSON.stringify(report));
  });

  it('centers the active row on open and keeps user scroll across re-renders', async (t) => {
    const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 800 } })).newPage();
    await page.setContent('<div class="theater-controls-wrapper" style="position:fixed;left:700px;bottom:24px"><div id="host" class="theater-cc-menu-host theater-menu-anchored"><button id="btn" type="button">CC</button><div id="menu" class="theater-cc-menu"></div></div></div>');
    await page.addStyleTag({ content: UI_CSS });
    await page.addScriptTag({ content: POPOVER });
    const report = await page.evaluate(`(() => {
      const menu = document.getElementById('menu');
      const render = (active) => {
        menu.replaceChildren();
        const list = document.createElement('div');
        list.className = 'theater-cc-menu-list';
        for (let i = 0; i < 60; i += 1) {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'theater-control-btn theater-settings-row theater-cc-menu-item' + (i === active ? ' active' : '');
          item.textContent = 'język ' + i;
          list.append(item);
        }
        menu.append(list);
      };
      let active = 30;
      const scope = { listen: (t, e, f, o) => t.addEventListener(e, f, o), add: () => {} };
      render(active);
      window.PopoverTest.bindMenuPopover({
        host: document.getElementById('host'), trigger: document.getElementById('btn'), panel: menu, scope,
        prepare: () => render(active), centerActiveIn: '.theater-cc-menu-list'
      });
      const offset = () => {
        const list = menu.querySelector('.theater-cc-menu-list');
        const l = list.getBoundingClientRect();
        const r = menu.querySelector('.active').getBoundingClientRect();
        return Math.abs((r.top + r.height / 2) - (l.top + l.height / 2));
      };
      const out = {};
      document.getElementById('btn').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      out.openOffset = offset();
      return out;
    })()`) as { openOffset: number };
    assert.ok(report.openOffset <= 2, JSON.stringify(report));

    const afterRerender = await page.evaluate(`(async () => {
      const menu = document.getElementById('menu');
      const list0 = menu.querySelector('.theater-cc-menu-list');
      const top = list0.scrollTop;
      list0.replaceWith(list0.cloneNode(true));
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      const centered = menu.querySelector('.theater-cc-menu-list').scrollTop;
      const list = menu.querySelector('.theater-cc-menu-list');
      list.dispatchEvent(new WheelEvent('wheel', { bubbles: true }));
      list.scrollTop = top + 40;
      await new Promise((r) => setTimeout(r, 50));
      const replacement = list.cloneNode(true);
      list.replaceWith(replacement);
      await new Promise((r) => setTimeout(r, 0));
      return { top, centered, kept: replacement.scrollTop, expected: top + 40 };
    })()`) as { top: number; centered: number; kept: number; expected: number };
    assert.ok(afterRerender.top > 0, JSON.stringify(afterRerender));
    assert.ok(Math.abs(afterRerender.centered - afterRerender.top) <= 2, JSON.stringify(afterRerender));
    assert.ok(Math.abs(afterRerender.kept - afterRerender.expected) <= 2, JSON.stringify(afterRerender));
  });
});
