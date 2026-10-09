import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { readStylesheet } from '../../test-utils/styles';

const require = createRequire(import.meta.url);
const SRC = path.dirname(fileURLToPath(import.meta.url));

describe('Disney theater captions', () => {
  it('injects caption CSS when Disney creates the timed-text region after theater mounts', async t => {
    const { chromium } = await import('playwright');
    let executable = '';
    try {
      executable = chromium.executablePath();
    } catch {
      t.skip('Chromium module or browser path is unavailable');
      return;
    }
    if (!existsSync(executable)) { t.skip('Chromium is not installed'); return; }
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
      await page.addStyleTag({ content: readStylesheet(new URL('./presentation.css', import.meta.url)) });
      await page.addScriptTag({ content: `${compiled}\nwindow.__stage = DisneyStage;` });
      const report = await page.evaluate(`(() => {
        const api = window.__stage;
        const helpers = { connected() { return true; }, refreshAncestors() {} };
        document.documentElement.style.setProperty('--theater-caption-bottom', '48px');
        api.disneyTheaterStage.mount('www.disneyplus.com');
        api.disneyTheaterStage.onStructuralMutation(document.body, helpers);
        const before = document.getElementById(api.DISNEY_CAPTION_STYLE_ID);
        const player = document.createElement('disney-web-player');
        player.className = 'theater-everywhere-parent-active';
        const ui = document.createElement('disney-web-player-ui');
        const chrome = document.createElement('div');
        const region = document.createElement('timed-text-override-region');
        const line = document.createElement('div');
        line.className = 'hive-subtitle-renderer-line';
        line.textContent = 'later';
        line.style.fontSize = '0px';
        const box = document.createElement('div');
        box.className = 'hive-subtitle-renderer-cue-positioning-box';
        region.attachShadow({ mode: 'open' }).append(line, box);
        ui.append(chrome, region);
        player.append(ui);
        document.body.append(player);
        api.disneyTheaterStage.onStructuralMutation(document.body, helpers);
        const injected = region.shadowRoot.getElementById(api.DISNEY_CAPTION_STYLE_ID);
        const fontSize = getComputedStyle(line).fontSize;
        const cueBottom = getComputedStyle(box).bottom;
        const playerZ = getComputedStyle(player).zIndex;
        const uiZ = getComputedStyle(ui).zIndex;
        const chromeVisibility = getComputedStyle(chrome).visibility;
        const dockedInset = getComputedStyle(region).getPropertyValue('--timed-text-override-region--inset-block-end').trim();
        document.documentElement.classList.add('theater-using-overlay-captions');
        const overlayVisibility = getComputedStyle(region).visibility;
        document.documentElement.classList.remove('theater-using-overlay-captions');
        const video = document.createElement('video');
        video.className = 'controls-visible';
        document.body.append(video);
        const raisedInset = getComputedStyle(region).getPropertyValue('--timed-text-override-region--inset-block-end').trim();
        api.disneyTheaterStage.unmount();
        api.disneyTheaterStage.onStructuralMutation(document.body, helpers);
        const afterUnmount = region.shadowRoot.getElementById(api.DISNEY_CAPTION_STYLE_ID);
        return {
          before: !!before,
          injected: !!injected,
          fontSize,
          cueBottom,
          playerZ,
          uiZ,
          chromeVisibility,
          dockedInset,
          overlayVisibility,
          raisedInset,
          afterUnmount: !!afterUnmount
        };
      })()`) as {
        before: boolean;
        injected: boolean;
        fontSize: string;
        cueBottom: string;
        playerZ: string;
        uiZ: string;
        chromeVisibility: string;
        dockedInset: string;
        overlayVisibility: string;
        raisedInset: string;
        afterUnmount: boolean;
      };
      assert.equal(report.before, false);
      assert.equal(report.injected, true);
      assert.equal(report.fontSize, '28px');
      assert.equal(report.cueBottom, '0px');
      assert.equal(report.playerZ, '2147483646');
      assert.equal(report.uiZ, '2147483647');
      assert.equal(report.chromeVisibility, 'hidden');
      assert.equal(report.dockedInset, '48px');
      assert.equal(report.overlayVisibility, 'hidden');
      assert.equal(report.raisedInset, 'max(132px, 48px)');
      assert.equal(report.afterUnmount, false);
    } finally {
      await browser.close();
    }
  });
});