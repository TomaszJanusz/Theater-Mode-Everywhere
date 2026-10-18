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
          const icons = root.querySelectorAll('.bass-icon');
          for (const level of ['moar', 'moaaarr'] as const) {
            const icon = icons[levels.indexOf(level)];
            out[level].reduced = {
              hop: getComputedStyle(icon.querySelector('.bass-hop')!).animationName,
              jitter: getComputedStyle(icon.querySelector('.bass-cone')!).animationName,
              color: getComputedStyle(icon).color
            };
          }
          return out;
        }, { css: UI_CSS, levels: [...BASS_LEVELS] });

        assert.deepEqual(BASS_LEVELS.map(level => result[level].waves), [[false, false, false], [true, false, false], [true, true, false], [true, true, false], [true, true, true]]);
        assert.deepEqual(BASS_LEVELS.map(level => result[level].hop), ['none', 'none', 'none', 'bass-hop', 'bass-hop-hard']);
        assert.deepEqual(BASS_LEVELS.map(level => result[level].jitter), ['none', 'none', 'none', 'bass-jitter', 'bass-jitter-hard']);
        assert.equal(result.moar.hopPeriod, '10s', 'one hop per foot every 5 s');
        assert.equal(result.moaaarr.hopPeriod, '5s', 'MOAAARR! hops twice as often');
        assert.equal(result.moaaarr.color, result.moar.color, 'both top levels share the red');
        assert.notEqual(result.moar.color, result.more.color, 'MOAAARR keeps its own red instead of the accent');
        for (const level of ['moar', 'moaaarr'] as const) {
          assert.equal(result[level].reduced?.hop, 'none');
          assert.equal(result[level].reduced?.jitter, 'none');
          assert.equal(result[level].reduced?.color, result[level].color, 'reduced motion keeps the red');
        }
        // Active rows take the accent on value; the default level keeps the ink.
        assert.notEqual(result.less.detail, result.original.detail, 'a non-default level is highlighted');
        assert.equal(result.more.detail, result.less.detail);
      } finally { await browser.close(); }
    });
  }
});
