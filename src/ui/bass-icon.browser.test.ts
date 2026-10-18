import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { BASS_LEVELS } from '../audio-settings';
import { readStylesheet } from '../test-utils/styles';

const require = createRequire(import.meta.url);
const SRC = new URL('../', import.meta.url).pathname;
const UI_CSS = readStylesheet(path.join(SRC, 'ui/shadow.css'));
const esbuild = require('esbuild') as { buildSync(options: object): { outputFiles: Array<{ text: string }> } };
const BUNDLE = esbuild.buildSync({
  stdin: { contents: "export { audioHudIcon } from './ui/hud';", resolveDir: SRC, loader: 'ts' },
  bundle: true, write: false, format: 'iife', globalName: 'Hud', platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;

describe('bass subwoofer icon', () => {
  for (const engine of ['chromium', 'firefox'] as const) {
    it(`follows the level and the active state in ${engine}`, { timeout: 60_000 }, async () => {
      const browserType = (await import('playwright'))[engine];
      assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
      const browser = await browserType.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent('<body></body>');
        await page.evaluate('window.__name = value => value');
        await page.addScriptTag({ content: BUNDLE });
        // The stylesheet targets :host, so the fixture lives in a shadow root like the player chrome.
        const result = await page.evaluate(({ css, levels }) => {
          const host = document.createElement('div');
          document.body.append(host);
          const root = host.attachShadow({ mode: 'open' });
          root.innerHTML = `<style>${css}</style>`;
          const read = (level: string) => {
            const row = document.createElement('div');
            row.className = 'theater-settings-row';
            row.dataset.active = String(level !== 'original');
            row.innerHTML = `<span class="theater-settings-row-icon">${(window as any).Hud.audioHudIcon('bass', { voice: 'off', leveling: 'off', bass: level })}</span><span class="theater-settings-detail">x</span>`;
            root.append(row);
            const svg = row.querySelector('svg')!;
            const style = (selector: string) => getComputedStyle(row.querySelector(selector)!);
            return {
              waves: [...row.querySelectorAll('.bass-wave')].map(wave => getComputedStyle(wave).display !== 'none'),
              hop: style('.bass-hop').animationName,
              jitter: style('.bass-cone').animationName,
              color: getComputedStyle(svg).color,
              detail: style('.theater-settings-detail').color,
              hopPeriod: style('.bass-hop').animationDuration
            };
          };
          const out: Record<string, ReturnType<typeof read> & { reduced?: { hop: string; jitter: string; color: string } }> = {};
          for (const level of levels) out[level] = read(level);
          host.setAttribute('data-motion', 'reduced');
          const moar = root.querySelectorAll('.bass-icon')[3];
          out.moar.reduced = {
            hop: getComputedStyle(moar.querySelector('.bass-hop')!).animationName,
            jitter: getComputedStyle(moar.querySelector('.bass-cone')!).animationName,
            color: getComputedStyle(moar).color
          };
          return out;
        }, { css: UI_CSS, levels: [...BASS_LEVELS] });

        assert.deepEqual(BASS_LEVELS.map(level => result[level].waves), [[false, false], [true, false], [true, true], [true, true]]);
        assert.deepEqual(BASS_LEVELS.map(level => result[level].hop === 'bass-hop'), [false, false, false, true]);
        assert.deepEqual(BASS_LEVELS.map(level => result[level].jitter === 'bass-jitter'), [false, false, false, true]);
        assert.equal(result.moar.hopPeriod, '10s', 'one hop per foot every 5 s');
        assert.notEqual(result.moar.color, result.more.color, 'MOAAARR keeps its own red instead of the accent');
        assert.equal(result.moar.reduced?.hop, 'none');
        assert.equal(result.moar.reduced?.jitter, 'none');
        assert.equal(result.moar.reduced?.color, result.moar.color, 'reduced motion keeps the red');
        // Active rows take the accent on value; the default level keeps the ink.
        assert.notEqual(result.less.detail, result.original.detail, 'a non-default level is highlighted');
        assert.equal(result.more.detail, result.less.detail);
      } finally { await browser.close(); }
    });
  }
});
