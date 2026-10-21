import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chromium, firefox } from 'playwright';

import { environment, LOCALES, LOCALE_ANCHORS, storyUrl } from '../.storybook/profiles';
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
        await page.goto(storyUrl(server.url, id, profile));
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
        assert.equal(actual.phase, 'finished', `${id}/${locale}`);
        assert.equal(actual.state?.globals.locale, locale, id);
        assert.equal(actual.lang, locale, id);
        assert.equal(actual.dir, locale === 'ar' ? 'rtl' : 'ltr', id);
        assert.equal(actual.motion, 'normal', id);
        if (id.includes('--seek')) assert.ok(actual.text?.includes({ en: '5 seconds', de: '5 Sekunden', ar: '5 ثوان' }[locale]), id);
        if (id.includes('volume-control')) assert.equal(actual.label, { en: 'Toggle mute', de: 'Stummschaltung umschalten', ar: 'تبديل كتم الصوت' }[locale]);
      }
    }
    // Real OS emulation, independent of the extension preference, including forced overrides.
    for (const os of ['reduce', 'no-preference'] as const) for (const preference of ['auto', 'on', 'off'] as const) {
      const profile = environment('en');
      profile.globals.reduceMotion = preference;
      await page.emulateMedia({ reducedMotion: os });
      await page.goto(storyUrl(server.url, 'player-volume-control--default', profile));
      const expected = preference === 'on' || (preference === 'auto' && os === 'reduce') ? 'reduced' : 'normal';
      await page.waitForFunction(value => document.getElementById('theater-everywhere-ui')?.dataset.motion === value, expected);
    }
  });
}
