import { readStylesheet } from '../test-utils/styles';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readStylesheet(path.join(SRC, 'content.css'));

describe('caption language menu', () => {
  it('keeps scrolled language rows below the title bar', async () => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) return;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.setContent('<div class="theater-controls-wrapper" style="position:fixed;left:700px;bottom:24px"><div class="theater-cc-menu-host theater-menu-anchored is-open"><div class="theater-cc-menu visible"><div class="theater-cc-menu-header"><span class="theater-cc-menu-title">Napisy</span><button type="button" class="theater-cc-menu-options">Opcje</button></div><div class="theater-cc-menu-list"></div></div></div></div>');
      await page.addStyleTag({ content: CSS });
      const report = await page.evaluate(`(() => {
        const list = document.querySelector('.theater-cc-menu-list');
        for (let i = 0; i < 40; i += 1) {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'theater-cc-menu-item';
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
    } finally {
      await browser.close();
    }
  });
});
