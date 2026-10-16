import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { it } from 'node:test';
import { chromium, firefox } from 'playwright';
import { ownTestBrowser } from './test-utils/test-browser';
const require = createRequire(import.meta.url);
const esbuild = require('esbuild') as typeof import('esbuild');
const bundle = esbuild.buildSync({ stdin: { contents: `
  import { applyAppearanceModes, isMotionReduced } from './appearance-runtime';
  window.setMotion = motion => {
    for (const target of [document.documentElement, document.getElementById('host')]) applyAppearanceModes(target, { contrast: false, transparency: false, motion });
  };
  window.isMotionReduced = () => isMotionReduced(document);`,
  resolveDir: new URL('./', import.meta.url).pathname, loader: 'ts' }, bundle: true, write: false, format: 'iife', target: 'es2022'
}).outputFiles[0].text;
const stylesheet = (path: string) => esbuild.buildSync({ entryPoints: [path], bundle: true, write: false, loader: { '.svg': 'dataurl' } }).outputFiles[0].text;
const optionsCss = stylesheet('options/options.css');
const shadowCss = stylesheet('src/ui/shadow.css');

for (const engine of [chromium, firefox]) it(`${engine.name()}: reduced motion collapses extension animation and stops the marquee`, { timeout: 30000 }, async t => {
  const browser = await engine.launch({ headless: true });
  ownTestBrowser(t, browser);
  const page = await browser.newPage();
  await page.setContent('<button class="choice-combobox" id="combo">Auto</button><div id="host"></div>');
  await page.addStyleTag({ content: optionsCss });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(css => {
    const shadow = document.getElementById('host')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${css}</style><div class="theater-everywhere-title-hud marquee"><div class="theater-title-hud-viewport"><div class="theater-title-hud-track"><span class="theater-title-hud-text">A very long title that overflows</span><span class="theater-title-hud-text theater-title-hud-text-clone">A very long title that overflows</span></div></div></div>`;
  }, shadowCss);
  const measure = () => page.evaluate(() => {
    const shadow = document.getElementById('host')!.shadowRoot!;
    const track = getComputedStyle(shadow.querySelector('.theater-title-hud-track')!);
    return {
      settings: parseFloat(getComputedStyle(document.getElementById('combo')!).transitionDuration),
      marquee: parseFloat(track.animationDuration),
      reduced: (window as unknown as { isMotionReduced(): boolean }).isMotionReduced()
    };
  });
  await page.evaluate(() => (window as unknown as { setMotion(on: boolean): void }).setMotion(false));
  const normal = await measure();
  assert.ok(normal.settings >= 0.1 && normal.marquee >= 1, 'normal motion keeps its timings');
  assert.equal(normal.reduced, false);
  await page.evaluate(() => (window as unknown as { setMotion(on: boolean): void }).setMotion(true));
  const reduced = await measure();
  assert.ok(reduced.settings < 0.001 && reduced.marquee < 0.001, 'settings transitions and the marquee collapse');
  assert.equal(reduced.reduced, true);
});
