import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { readStylesheet } from '../../test-utils/styles';
import { DISNEY_CAPTION_SHADOW_CSS } from './stage';

const require = createRequire(import.meta.url);
const SRC = path.dirname(fileURLToPath(import.meta.url));

describe('Disney theater captions', () => {
  it('lifts the timed-text layer above the pinned video and docks it with the control bar', () => {
    const css = readStylesheet(new URL('./presentation.css', import.meta.url));
    assert.match(css, /disney-web-player\.theater-everywhere-parent-active\s*\{[^}]*z-index:\s*2147483646/);
    assert.match(css, /disney-web-player-ui\s*\{[^}]*z-index:\s*2147483647/);
    assert.match(css, /disney-web-player-ui > :not\(timed-text-override-region\)\s*\{[^}]*visibility:\s*hidden/);
    assert.match(css, /theater-using-overlay-captions timed-text-override-region\s*\{[^}]*visibility:\s*hidden/);
    assert.match(css, /timed-text-override-region\s*\{[^}]*--timed-text-override-region--inset-block-end:\s*var\(--theater-caption-bottom,\s*48px\)/);
    assert.match(css, /:has\(video\.controls-visible\) timed-text-override-region\s*\{[^}]*max\(132px, var\(--theater-caption-bottom/);
    assert.match(DISNEY_CAPTION_SHADOW_CSS, /font-size:\s*calc\(28px \* var\(--theater-caption-scale, 1\)\)/);
    assert.match(DISNEY_CAPTION_SHADOW_CSS, /bottom:\s*0 !important/);
  });

  it('injects caption CSS when Disney creates the timed-text region after theater mounts', async () => {
    let executable = '';
    try {
      const { chromium } = await import('playwright');
      executable = chromium.executablePath();
      if (!existsSync(executable)) return;
      const esbuild = require(createRequire(require.resolve('vite')).resolve('esbuild')) as {
        buildSync: (options: {
          stdin: { contents: string; resolveDir: string; sourcefile: string; loader: 'ts' };
          bundle: true;
          write: false;
          format: 'iife';
          globalName: string;
          platform: 'browser';
          target: string;
          logLevel: 'silent';
        }) => { outputFiles: Array<{ text: string }> };
      };
      const compiled = esbuild.buildSync({
        stdin: {
          contents: "import { disneyTheaterStage, DISNEY_CAPTION_STYLE_ID } from './stage'; export { disneyTheaterStage, DISNEY_CAPTION_STYLE_ID };",
          resolveDir: SRC,
          sourcefile: 'disney-stage-browser-entry.ts',
          loader: 'ts'
        },
        bundle: true,
        write: false,
        format: 'iife',
        globalName: 'DisneyStage',
        platform: 'browser',
        target: 'es2022',
        logLevel: 'silent'
      }).outputFiles[0].text;
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.route('https://www.disneyplus.com/**', (route) => {
          if (route.request().resourceType() !== 'document') return route.abort();
          return route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><html><body></body></html>'
          });
        });
        await page.goto('https://www.disneyplus.com/pl-pl/play/86e14fdb-3841-4282-ad38-07c8c4aab4b6', { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ content: `${compiled}\nwindow.__stage = DisneyStage;` });
        const report = await page.evaluate(`(() => {
          const api = window.__stage;
          const helpers = { connected() { return true; }, refreshAncestors() {} };
          api.disneyTheaterStage.mount('www.disneyplus.com');
          api.disneyTheaterStage.onStructuralMutation(document.body, helpers);
          const before = document.getElementById(api.DISNEY_CAPTION_STYLE_ID);
          const region = document.createElement('timed-text-override-region');
          const line = document.createElement('div');
          line.className = 'hive-subtitle-renderer-line';
          line.textContent = 'later';
          line.style.fontSize = '0px';
          region.attachShadow({ mode: 'open' }).append(line);
          document.body.append(region);
          api.disneyTheaterStage.onStructuralMutation(document.body, helpers);
          const injected = region.shadowRoot.getElementById(api.DISNEY_CAPTION_STYLE_ID);
          const fontSize = getComputedStyle(line).fontSize;
          api.disneyTheaterStage.unmount();
          api.disneyTheaterStage.onStructuralMutation(document.body, helpers);
          const afterUnmount = region.shadowRoot.getElementById(api.DISNEY_CAPTION_STYLE_ID);
          return { before: !!before, injected: !!injected, fontSize, afterUnmount: !!afterUnmount };
        })()`) as { before: boolean; injected: boolean; fontSize: string; afterUnmount: boolean };
        assert.equal(report.before, false);
        assert.equal(report.injected, true);
        assert.equal(report.fontSize, '28px');
        assert.equal(report.afterUnmount, false);
      } finally {
        await browser.close();
      }
    } catch (error) {
      if (!executable) return;
      throw error;
    }
  });
});