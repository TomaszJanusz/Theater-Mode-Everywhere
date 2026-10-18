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
  stdin: {
    contents: [
      "export { createHud, audioHudIcon } from './ui/hud';",
      "export { applyAccentColorPreset } from './accentTheme';"
    ].join('\n'),
    resolveDir: SRC,
    loader: 'ts'
  },
  bundle: true, write: false, format: 'iife', globalName: 'Hud', platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;

// The HUD is painted like the player paints it: paintOverlay stamps the user's accent inline on the
// overlay, which is what once beat the stylesheet's red for the top bass levels.
describe('bass confirmation HUD', () => {
  for (const engine of ['chromium', 'firefox'] as const) {
    it(`turns red at MOAAR and MOAAARR! despite a user accent in ${engine}`, { timeout: 60_000 }, async () => {
      const browserType = (await import('playwright'))[engine];
      assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
      const browser = await browserType.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.setContent('<body></body>');
        await page.addStyleTag({ content: UI_CSS });
        await page.evaluate('window.__name = value => value');
        await page.addScriptTag({ content: BUNDLE });
        const huds = await page.evaluate((levels) => {
          const api = (window as any).Hud;
          const noop = () => {};
          const ctx: any = {
            session: { element: document.body },
            queryPlayerUi: (selector: string) => document.querySelector(selector),
            mountPlayerUi: (element: HTMLElement) => document.body.append(element),
            paintOverlay: (element: HTMLElement) => api.applyAccentColorPreset(element, 'green'),
            t: (key: string) => key
          };
          const hud = api.createHud(ctx, noop);
          const probe = (color: string) => { const element = document.createElement('i'); element.style.color = color; document.body.append(element); const resolved = getComputedStyle(element).color; element.remove(); return resolved; };
          const out: Record<string, { text: string; icon: string; svg: string; outline: string }> = {};
          for (const level of levels) {
            hud.triggerStatusIndicator('Bass: ' + level, api.audioHudIcon('bass', { voice: 'off', leveling: 'off', bass: level }), level === 'moar' || level === 'moaaarr' ? level : undefined);
            const overlay = document.querySelector<HTMLElement>('.theater-everywhere-volume-overlay')!;
            out[level] = {
              text: getComputedStyle(overlay.querySelector('.volume-hud-text')!).color,
              icon: getComputedStyle(overlay.querySelector('.volume-hud-icon')!).color,
              svg: getComputedStyle(overlay.querySelector('.bass-icon')!).color,
              outline: getComputedStyle(overlay).outlineColor
            };
          }
          return { out, green: probe('#51cd00'), red: probe('#ef4444') };
        }, [...BASS_LEVELS]);
        const { out, green, red } = huds;
        for (const level of BASS_LEVELS.filter(level => level === 'moar' || level === 'moaaarr')) {
          assert.deepEqual([out[level].text, out[level].icon, out[level].svg], [red, red, red], `${level} HUD text and icon are red, not the green accent`);
          assert.notEqual(out[level].outline, out.more.outline, `${level} HUD border is tinted red`);
        }
        for (const level of BASS_LEVELS.filter(level => level !== 'moar' && level !== 'moaaarr')) {
          assert.equal(out[level].icon, green, `${level} HUD icon keeps the user accent`);
          assert.notEqual(out[level].text, red, `${level} HUD text is not red`);
        }
      } finally { await browser.close(); }
    });
  }
});
