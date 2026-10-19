import { testEngines } from '../test-utils/test-engines';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { it } from 'node:test';
import type { Page } from 'playwright';
import { readStylesheet } from '../test-utils/styles';
import { ownTestBrowser } from '../test-utils/test-browser';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild') as { buildSync(options: object): { outputFiles: Array<{ text: string }> } };
const BUNDLE = esbuild.buildSync({
  stdin: {
    contents: "export { showAutoTheaterNotice } from './ui/auto-theater-notice'; export { setPlayerUiCss } from './ui/root';",
    resolveDir: new URL('../', import.meta.url).pathname, loader: 'ts'
  },
  bundle: true, write: false, format: 'iife', globalName: 'NoticeTest', platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;
const CSS = readStylesheet(new URL('./shadow.css', import.meta.url));

declare global {
  interface Window {
    NoticeTest: {
      showAutoTheaterNotice(paint: (element: HTMLElement) => void, cancel: () => void, remainingMs: () => number, ringTurn?: 'uniform' | 'per-digit'): () => void;
      setPlayerUiCss(css: string): void;
    };
    noticeHide: () => void;
  }
}

/** Shows the notice with a 3 s deadline on the page's fake clock. */
async function mountNotice(page: Page, ringTurn?: 'uniform' | 'per-digit'): Promise<void> {
  await page.addInitScript('window.__name = target => target;');
  await page.goto('about:blank');
  await page.addScriptTag({ content: BUNDLE });
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  await page.evaluate(([css, mode]) => {
    window.NoticeTest.setPlayerUiCss(css!);
    const deadline = performance.now() + 3000;
    window.noticeHide = window.NoticeTest.showAutoTheaterNotice(() => {}, () => {}, () => Math.max(0, deadline - performance.now()), mode as 'uniform' | 'per-digit' | undefined);
  }, [CSS, ringTurn]);
}

const readout = (page: Page) => page.evaluate(() => {
  const count = document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-auto-notice-count');
  return count ? { text: count.querySelector('.theater-time-glyph:not(.is-leaving)')!.textContent, ariaHidden: count.getAttribute('aria-hidden'), rolling: count.querySelectorAll('.is-rolling').length } : null;
});

const ring = (page: Page) => page.evaluate(() => {
  const spinner = document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-auto-notice .caption-hud-spinner')!;
  // The page clock is faked, but animations keep running on the document timeline, so only the restart is stable.
  const turns = spinner.getAnimations().filter(a => a.effect instanceof KeyframeEffect && a.effect.getKeyframes().some(k => k.rotate));
  const timing = turns[0]?.effect?.getTiming();
  return { turns: turns.length, time: Math.round(Number(turns[0]?.currentTime ?? -1)), iterations: timing?.iterations, easing: timing?.easing };
});

for (const engine of testEngines()) {
  it(`${engine}: the notice counts the remaining seconds with the shared digit roll and stops on cleanup`, { timeout: 40_000 }, async t => {
    const browser = await (await import('playwright'))[engine].launch({ headless: true });
    ownTestBrowser(t, browser);
    const page = await browser.newPage();
    await mountNotice(page);
    assert.deepEqual(await readout(page), { text: '2', ariaHidden: 'true', rolling: 0 });
    await page.clock.runFor(999);
    assert.equal((await readout(page))!.text, '2');
    await page.clock.runFor(1);
    assert.deepEqual(await readout(page), { text: '1', ariaHidden: 'true', rolling: 1 }, 'a changed second rolls through the slot');
    const uniform = await ring(page);
    assert.deepEqual([uniform.turns, uniform.iterations, uniform.easing], [1, Infinity, 'linear'], 'one continuous linear turn, not restarted by digit changes');
    await page.clock.runFor(999);
    assert.equal((await readout(page))!.text, '1');
    await page.clock.runFor(1);
    assert.equal((await readout(page))!.text, '0', 'the countdown ends on 0');
    await page.clock.runFor(5000);
    assert.equal((await readout(page))!.text, '0', 'zero holds while entry waits for playback');
    const notice = page.locator('#theater-everywhere-ui .theater-auto-notice');
    assert.equal(await notice.getAttribute('aria-live'), 'polite');
    assert.match((await notice.getAttribute('aria-label'))!, /Entering theater mode/);

    // Reduced motion swaps the digit without a roll.
    await page.evaluate(() => { document.documentElement.dataset.motion = 'reduced'; window.noticeHide(); });
    await page.evaluate(() => {
      const end = performance.now() + 3000;
      window.noticeHide = window.NoticeTest.showAutoTheaterNotice(() => {}, () => {}, () => Math.max(0, end - performance.now()));
    });
    await page.clock.runFor(1000);
    assert.deepEqual(await readout(page), { text: '1', ariaHidden: 'true', rolling: 0 });
    assert.equal((await ring(page)).turns, 0, 'reduced motion leaves the ring still');

    // Cleanup removes the notice and leaves no timer to touch it again.
    await page.evaluate(() => { window.noticeHide(); window.noticeHide(); });
    assert.equal(await readout(page), null);
    await page.clock.runFor(5000);
    assert.equal(await readout(page), null);
  });
}

for (const engine of testEngines()) {
  it(`${engine}: the per-digit ring mode restarts one eased turn with each digit change`, { timeout: 40_000 }, async t => {
    const browser = await (await import('playwright'))[engine].launch({ headless: true });
    ownTestBrowser(t, browser);
    const page = await browser.newPage();
    await mountNotice(page, 'per-digit');
    await page.clock.runFor(1000);
    assert.equal((await readout(page))!.text, '1');
    const restarted = await ring(page);
    assert.equal(restarted.turns, 1, 'one ring turn per second, replacing the previous one');
    assert.ok(restarted.time < 250, 'the turn restarts with the digit change');
    assert.notEqual(restarted.easing, 'linear');
  });
}

/** Plate facts sampled on the page itself, so no frame between two samples can hide a transparent moment. */
const SAMPLER = `(${(() => {
  const samples: Array<Record<string, string | number>> = [];
  const overlay = () => document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector<HTMLElement>('.theater-auto-notice');
  const timer = setInterval(() => {
    const el = overlay();
    if (!el) return;
    const style = getComputedStyle(el);
    const alpha = /rgba?\(([^)]*)\)/.exec(style.backgroundColor)?.[1].split(/[ ,/]+/).filter(Boolean)[3];
    samples.push({
      t: Math.round(performance.now()), alpha: alpha === undefined ? 1 : Number(alpha), opacity: Number(style.opacity),
      width: el.getBoundingClientRect().width
    });
  }, 40);
  Object.assign(window, { plateSamples: samples });
  (window as unknown as { stopSamples: () => typeof samples }).stopSamples = () => { clearInterval(timer); return samples; };
}).toString()})()`;

for (const engine of testEngines()) {
  for (const mode of ['normal', 'reduced transparency', 'high contrast', 'reduced motion'] as const) {
    it(`${engine}: the notice plate stays opaque through appear, countdown, ring exit and 0 (${mode})`, { timeout: 40_000 }, async t => {
      const browser = await (await import('playwright'))[engine].launch({ headless: true });
      ownTestBrowser(t, browser);
      const page = await browser.newPage();
      await page.addInitScript('window.__name = target => target;');
      await page.goto('about:blank');
      await page.setContent('<body style="margin:0;background:#fff;height:900px"></body>');
      await page.addScriptTag({ content: BUNDLE });
      await page.evaluate(([css, how]) => {
        window.NoticeTest.setPlayerUiCss(css!);
        const host = document.getElementById('theater-everywhere-ui') ?? (() => { window.NoticeTest.showAutoTheaterNotice(() => {}, () => {}, () => 0)(); return document.getElementById('theater-everywhere-ui')!; })();
        if (how === 'reduced transparency') host.setAttribute('data-transparency', 'reduced');
        if (how === 'high contrast') host.setAttribute('data-contrast', 'high');
        if (how === 'reduced motion') host.setAttribute('data-motion', 'reduced');
      }, [CSS, mode]);
      await page.evaluate(SAMPLER);
      await page.evaluate(() => {
        const deadline = performance.now() + 2200;
        window.noticeHide = window.NoticeTest.showAutoTheaterNotice(() => {}, () => {}, () => Math.max(0, deadline - performance.now()));
      });
      // Zero is the final displayed second; the ring's completed exit is the
      // positive signal that sampling covered both the countdown and its fade.
      await page.waitForFunction(() => {
        const notice = document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-auto-notice')!;
        return notice.querySelector('.theater-time-glyph:not(.is-leaving)')?.textContent === '0'
          && !notice.querySelector('.caption-hud-spinner')
          && (window as unknown as { plateSamples: unknown[] }).plateSamples.length > 40;
      });
      const samples = await page.evaluate(() => (window as unknown as { stopSamples(): Array<Record<string, number | string>> }).stopSamples());
      assert.ok(samples.length > 40, 'sampled across the whole countdown');
      for (const s of samples) {
        assert.equal(s.alpha, 1, `plate background opaque at ${JSON.stringify(s)}`);
        assert.equal(s.opacity, 1, `notice opaque at ${JSON.stringify(s)}`);
      }
      const widths = new Set(samples.map(s => s.width));
      assert.equal(widths.size, 1, 'the plate never morphs its width during the countdown');
    });
  }
}
