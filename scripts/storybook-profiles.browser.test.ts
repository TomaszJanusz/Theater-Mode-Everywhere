import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chromium, firefox } from 'playwright';

import { openStory, waitForStory as finished } from '../.storybook/browser-navigation';
import { environment, LOCALES, LOCALE_ANCHORS, NARROW_ANCHORS, profilesFor } from '../.storybook/profiles';
import { serveStorybook } from '../.storybook/static-server';
import { sharedTestBrowser } from '../src/test-utils/test-browser';
import { testEngines } from '../src/test-utils/test-engines';


for (const engine of testEngines()) {
  const browser = sharedTestBrowser({ chromium, firefox }[engine]);
  test(`Storybook requested environment reaches rendered production roots (${engine})`, { timeout: 120000 }, async t => {
    const server = await serveStorybook();
    t.after(server.close);
    const context = await browser.newContext(t, { reducedMotion: 'reduce' });
    const page = await context.newPage();
    for (const locale of LOCALES) {
      for (const id of Object.keys(LOCALE_ANCHORS)) {
        const profile = environment(locale);
        profile.args = LOCALE_ANCHORS[id](locale);
        await openStory(page, server.url, id, profile);
        await page.waitForFunction(() => {
          const preview = (window as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } }).__STORYBOOK_PREVIEW__;
          return ['finished', 'errored', 'aborted'].includes(preview?.currentRender?.phase ?? '');
        }).catch(async error => { throw new Error(`${id}/${locale}: ${await page.locator('body').innerText()}`, { cause: error }); });
        const actual = await page.evaluate(() => {
          const host = document.getElementById('theater-everywhere-ui');
          return {
            phase: (window as unknown as { __STORYBOOK_PREVIEW__: { currentRender: { phase: string } } }).__STORYBOOK_PREVIEW__.currentRender.phase,
            state: window.__storyState, lang: host?.lang, dir: host?.dir, motion: host?.dataset.motion,
            text: host?.shadowRoot?.textContent,
            label: host?.shadowRoot?.querySelector('.volume-btn')?.getAttribute('aria-label')
          };
        });
        for (const [key, value] of Object.entries(profile.args)) assert.equal(actual.state?.args[key], value, `${id}/${locale}/${key}`);
        assert.equal(actual.phase, 'finished', `${id}/${locale}`);
        assert.equal(actual.state?.globals.locale, locale, id);
        assert.equal(actual.lang, locale, id);
        assert.equal(actual.dir, locale === 'ar' ? 'rtl' : 'ltr', id);
        assert.equal(actual.motion, 'normal', id);
        if (id.includes('--seek')) assert.ok(actual.text?.includes({ en: '5 seconds', de: '5 Sekunden', ar: '5 ثوان' }[locale]), id);
        if (id.includes('volume-control')) assert.equal(actual.label, { en: 'Toggle mute', de: 'Stummschaltung umschalten', ar: 'تبديل كتم الصوت' }[locale]);
      }
    }
    // The top-layer host must track the browser viewport, not a resized fixture container.
    for (const id of NARROW_ANCHORS) {
      const narrow = profilesFor(id, engine).find(profile => profile.name === 'narrow-de')!;
      for (const width of [640, narrow.viewport.width]) {
        await page.setViewportSize({ width, height: 360 });
        await openStory(page, server.url, id, { ...narrow, viewport: { width, height: 360 } });
        await page.waitForFunction(expected => document.getElementById('theater-everywhere-ui')?.getBoundingClientRect().width === expected, width);
        assert.equal(await page.evaluate(() => window.innerWidth), width);
        assert.equal(await page.locator('#theater-everywhere-ui').evaluate(host => host.matches(':popover-open')), true);
      }
    }
    // Real OS emulation, independent of the extension preference, including forced overrides.
    for (const os of ['reduce', 'no-preference'] as const) for (const preference of ['auto', 'on', 'off'] as const) {
      const profile = environment('en');
      profile.globals.reduceMotion = preference;
      profile.reducedMotion = os;
      await openStory(page, server.url, 'player-volume-control--closed', profile);
      const expected = preference === 'on' || (preference === 'auto' && os === 'reduce') ? 'reduced' : 'normal';
      await page.waitForFunction(value => document.getElementById('theater-everywhere-ui')?.dataset.motion === value, expected);
    }
  });
}

for (const engine of testEngines()) {
  const browser = sharedTestBrowser({ chromium, firefox }[engine]);
  test(`Storybook control args and pointer/keyboard behavior (${engine})`, { timeout: 60000 }, async t => {
    const server = await serveStorybook();
    t.after(server.close);
    const context = await browser.newContext(t, { viewport: { width: 640, height: 360 } });
    const page = await context.newPage();
    for (const family of ['volume', 'speed'] as const) {
      for (const disabled of [false, true]) {
        const profile = environment();
        profile.args = { disabled, open: true, ...(family === 'speed' ? { rate: 2 } : { volume: 0.3, muted: true }) };
        await openStory(page, server.url, `player-${family}-control--open`, profile);
        await finished(page);
        const button = page.locator(`.${family}-btn`);
        assert.equal(await button.isDisabled(), disabled);
        assert.equal(await page.locator(`.theater-${family}-slider`).isDisabled(), disabled);
        if (family === 'speed') assert.equal(await button.textContent(), '2x');
        else assert.equal(await page.locator('.theater-volume-slider').getAttribute('aria-valuetext'), '0%');
      }
    }
    for (let replay = 0; replay < 2; replay++) {
      await openStory(page, server.url, 'player-speed-control--closed', environment());
      await finished(page);
      const button = page.locator('.speed-btn');
      const panel = page.locator('.theater-speed-panel');
      await button.waitFor();
      await page.locator('.theater-speed-container').hover();
      await page.waitForFunction(() => !document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector<HTMLElement>('.theater-speed-panel')?.inert);
      await page.mouse.move(600, 10);
      await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector<HTMLElement>('.theater-speed-panel')?.inert);
      await page.evaluate(() => {
        document.documentElement.dataset.escapes = '0';
        document.addEventListener('keydown', () => { document.documentElement.dataset.escapes = String(Number(document.documentElement.dataset.escapes) + 1); });
      });
      await button.focus();
      assert.equal(await panel.evaluate(node => (node as HTMLElement).inert), false);
      await page.keyboard.press('Escape');
      assert.equal(await panel.evaluate(node => (node as HTMLElement).inert), true);
      assert.equal(await button.evaluate(node => node.matches(':focus')), true);
      assert.equal(await page.locator('html').getAttribute('data-escapes'), '0');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('html').getAttribute('data-escapes'), '1');
    }
    await openStory(page, server.url, 'player-control-button-tooltip--closed', environment());
    await finished(page);
    await page.locator('.theater-control-btn').hover();
    await page.waitForFunction(() => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-button-tooltip')?.classList.contains('visible'));
    await page.mouse.move(600, 10);
    await page.waitForFunction(() => !document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-button-tooltip')?.classList.contains('visible'));
  });
}
