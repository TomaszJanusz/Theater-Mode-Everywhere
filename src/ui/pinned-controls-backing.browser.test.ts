import { testEngines } from '../test-utils/test-engines';
import { readStylesheet } from '../test-utils/styles';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import type { BrowserType } from 'playwright';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI_CSS = readStylesheet(path.join(SRC, 'ui/shadow.css'));

const BUSY = 'repeating-linear-gradient(45deg, #fff 0 12px, #f0c 12px 24px, #0ff 24px 36px)';

// Ancestors that change stacking or blending must not make the plate see through.
const ANCESTORS: Record<string, string> = {
  plain: '',
  isolation: 'isolation:isolate;',
  blend: 'mix-blend-mode:difference;',
  transform: 'transform:translateZ(0);'
};

describe('pinned controls backing', () => {
  for (const engine of testEngines()) {
    it(`keeps the docked plate opaque over busy page content while the floating bar stays glass (${engine})`, async (t) => {
      const playwright = await import('playwright');
      const type = playwright[engine] as BrowserType;
      let executable = '';
      try {
        executable = type.executablePath();
      } catch {
        t.skip(`${engine} module or browser path is unavailable`);
        return;
      }
      if (!existsSync(executable)) { t.skip(`${engine} is not installed`); return; }
      const browser = await type.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 900, height: 400 } });
        for (const [name, style] of Object.entries(ANCESTORS)) {
          await page.setContent(`<div style="position:absolute;inset:0;background:${BUSY};${style}">
            <div class="theater-controls-wrapper visible pinned" id="pinned"><div class="theater-controls-row">x</div></div>
            <div class="theater-controls-wrapper visible" id="floating"><div class="theater-controls-row">x</div></div>
          </div>`);
          await page.addStyleTag({ content: UI_CSS });
          const alpha = (id: string) => page.evaluate(`(() => {
            const color = getComputedStyle(document.getElementById('${id}'), '::before').backgroundColor;
            const m = color.match(/\\/\\s*([\\d.]+)\\s*\\)|rgba\\([^)]*,\\s*([\\d.]+)\\)/);
            return m ? Number(m[1] ?? m[2]) : 1;
          })()`) as Promise<number>;
          assert.equal(await alpha('pinned'), 1, `${engine} ${name}: pinned plate must be opaque`);
          assert.ok(await alpha('floating') < 1, `${engine} ${name}: floating bar keeps its translucency`);
        }
      } finally {
        await browser.close();
      }
    });
  }
});
