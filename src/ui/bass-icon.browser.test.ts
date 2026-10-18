import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { BASS_LEVELS, BASS_MOAAARR_ENABLED } from '../audio-settings';
import { readStylesheet } from '../test-utils/styles';

const require = createRequire(import.meta.url);
const SRC = new URL('../', import.meta.url).pathname;
const UI_CSS = readStylesheet(path.join(SRC, 'ui/shadow.css'));
const esbuild = require('esbuild') as { buildSync(options: object): { outputFiles: Array<{ text: string }> } };
const BUNDLE = esbuild.buildSync({
  stdin: { contents: "export { audioHudIcon } from './ui/hud';", resolveDir: SRC, loader: 'ts' },
  bundle: true, write: false, format: 'iife', globalName: 'Hud', platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;

// MOAAARR! may be gated off (BASS_MOAAARR_ENABLED), leaving MOAAR as the only red level.
const redLevels = BASS_LEVELS.filter((level): level is 'moar' | 'moaaarr' => level === 'moar' || level === 'moaaarr');

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
        const { out: result, huds, sweepNormal, sweepReduced } = await page.evaluate(({ css, levels }) => {
          const host = document.createElement('div');
          document.body.append(host);
          const root = host.attachShadow({ mode: 'open' });
          root.innerHTML = `<style>${css}</style>`;
          const read = (level: string) => {
            const row = document.createElement('div');
            row.className = 'theater-settings-row';
            row.dataset.active = String(level !== 'original');
            row.dataset.level = level;
            row.innerHTML = `<span class="theater-settings-row-icon">${(window as any).Hud.audioHudIcon('bass', { voice: 'off', leveling: 'off', bass: level })}</span><span class="theater-settings-label">Bass</span><span class="theater-settings-detail">x</span>`;
            root.append(row);
            const svg = row.querySelector('svg')!;
            const style = (selector: string) => getComputedStyle(row.querySelector(selector)!);
            return {
              waves: [...row.querySelectorAll('.bass-wave')].map(wave => getComputedStyle(wave).display !== 'none'),
              hop: style('.bass-hop').animationName,
              jitter: style('.bass-cone').animationName,
              color: getComputedStyle(svg).color,
              detail: style('.theater-settings-detail').color,
              label: style('.theater-settings-label').color,
              rowIcon: style('.theater-settings-row-icon').color,
              focus: getComputedStyle(row).getPropertyValue('--accent-color'),
              centres: [row.querySelector<SVGGraphicsElement>('.bass-cabinet')!, row.querySelector<SVGGraphicsElement>('.bass-cone')!].map(shape => { const box = shape.getBBox(); return box.x + box.width / 2; }),
              cabinet: ['width', 'height'].map(side => row.querySelector('.bass-cabinet')!.getAttribute(side)),
              hopPeriod: style('.bass-hop').animationDuration
            };
          };
          const hud = (level: string) => {
            const overlay = document.createElement('div');
            overlay.className = 'theater-everywhere-volume-overlay status-hud';
            if (level === 'moar' || level === 'moaaarr') overlay.dataset.level = level;
            overlay.innerHTML = `<div class="volume-hud-content"><div class="volume-hud-icon">${(window as any).Hud.audioHudIcon('bass', { voice: 'off', leveling: 'off', bass: level })}</div><span class="volume-hud-text">Bass</span></div>`;
            root.append(overlay);
            return {
              text: getComputedStyle(overlay.querySelector('.volume-hud-text')!).color,
              icon: getComputedStyle(overlay.querySelector('.volume-hud-icon')!).color,
              outline: getComputedStyle(overlay).outlineColor
            };
          };
          const out: Record<string, ReturnType<typeof read> & { reduced?: { hop: string; jitter: string; color: string } }> = {};
          for (const level of levels) out[level] = read(level);
          const huds = Object.fromEntries(levels.map(level => [level, hud(level)]));
          host.setAttribute('data-motion', 'reduced');
          const icons = root.querySelectorAll('.bass-icon');
          for (const level of levels.filter(candidate => candidate === 'moar' || candidate === 'moaaarr')) {
            const icon = icons[levels.indexOf(level)];
            out[level].reduced = {
              hop: getComputedStyle(icon.querySelector('.bass-hop')!).animationName,
              jitter: getComputedStyle(icon.querySelector('.bass-cone')!).animationName,
              color: getComputedStyle(icon).color
            };
          }
          // The Bass row's sweep reuses the CTA sweep; reduced motion removes it like the CTA's.
          const sweepRow = document.createElement('div');
          sweepRow.className = 'theater-settings-row is-sweeping';
          sweepRow.dataset.level = 'moar';
          root.append(sweepRow);
          const sweepAfter = () => { const style = getComputedStyle(sweepRow, '::after'); return { content: style.content, animation: style.animationName }; };
          host.removeAttribute('data-motion');
          const sweepNormal = sweepAfter();
          host.setAttribute('data-motion', 'reduced');
          const sweepReduced = sweepAfter();
          return { out, huds, sweepNormal, sweepReduced };
        }, { css: UI_CSS, levels: [...BASS_LEVELS] });

        const arcs = { less: 0, original: 1, more: 2, moar: 2, moaaarr: 3 };
        assert.deepEqual(BASS_LEVELS.map(level => result[level].waves), BASS_LEVELS.map(level => [0, 1, 2].map(index => index < arcs[level])));
        const motion = { hop: { moar: 'bass-hop', moaaarr: 'bass-hop-hard' }, jitter: { moar: 'bass-jitter', moaaarr: 'bass-jitter-hard' } } as Record<string, Record<string, string>>;
        assert.deepEqual(BASS_LEVELS.map(level => result[level].hop), BASS_LEVELS.map(level => motion.hop[level] ?? 'none'));
        assert.deepEqual(BASS_LEVELS.map(level => result[level].jitter), BASS_LEVELS.map(level => motion.jitter[level] ?? 'none'));
        // The waves overhang the box, so the cabinet and cone stay centred on the 24-unit viewBox at every level.
        for (const level of BASS_LEVELS) for (const centre of result[level].centres) assert.ok(Math.abs(centre - 12) <= 0.1, `${level} cabinet centre ${centre}`);
        for (const level of BASS_LEVELS) assert.equal(result[level].cabinet[0], result[level].cabinet[1], `${level} cabinet is a square`);
        assert.equal(result.moar.hopPeriod, '10s', 'one hop per foot every 5 s');
        if (BASS_MOAAARR_ENABLED) {
          assert.equal(result.moaaarr.hopPeriod, '5s', 'MOAAARR! hops twice as often');
          assert.equal(result.moaaarr.color, result.moar.color, 'both top levels share the red');
        }
        assert.notEqual(result.moar.color, result.more.color, 'MOAAARR keeps its own red instead of the accent');
        for (const level of redLevels) {
          assert.equal(result[level].reduced?.hop, 'none');
          assert.equal(result[level].reduced?.jitter, 'none');
          assert.equal(result[level].reduced?.color, result[level].color, 'reduced motion keeps the red');
        }
        // Active rows take the accent on value; the default level keeps the ink.
        assert.notEqual(result.less.detail, result.original.detail, 'a non-default level is highlighted');
        assert.equal(result.more.detail, result.less.detail);
        // The whole row turns red at the two top levels and keeps the user accent below them.
        const red = result.moar.color;
        for (const level of redLevels) {
          assert.deepEqual([result[level].label, result[level].detail, result[level].rowIcon, result[level].color], [red, red, red, red], `${level} row is red`);
          assert.equal(result[level].focus.trim(), '#ef4444', `${level} focus and active accent follow the red`);
        }
        for (const level of ['less', 'more'] as const) {
          assert.notEqual(result[level].detail, red, `${level} keeps the user accent`);
          assert.notEqual(result[level].label, red);
        }
        assert.equal(result.original.focus.trim(), '', 'the default level leaves the accent alone');
        // The confirmation HUD follows the same rule: red text, icon and outline at the top two levels only.
        for (const level of redLevels) {
          assert.deepEqual([huds[level].text, huds[level].icon], [red, red], `${level} HUD text and icon are red`);
          assert.notEqual(huds[level].outline, huds.more.outline, `${level} HUD outline is tinted red`);
        }
        for (const level of ['less', 'original', 'more'] as const) {
          assert.notEqual(huds[level].text, red, `${level} HUD text keeps its styling`);
          assert.notEqual(huds[level].icon, red, `${level} HUD icon keeps the accent`);
        }
        assert.equal(sweepNormal.animation, 'theater-service-action-sweep', 'the Bass row reuses the CTA sweep');
        assert.notEqual(sweepNormal.content, 'none');
        assert.deepEqual([sweepReduced.content, sweepReduced.animation], ['none', 'none'], 'reduced motion removes the sweep');
      } finally { await browser.close(); }
    });
  }
});
