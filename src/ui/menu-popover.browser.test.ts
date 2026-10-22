import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chromium, firefox } from 'playwright';

import { bootPlayer, enterTheater } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';
import { serveFixture, vodVideoFixture } from '../test-utils/video-fixtures';

const FIXTURE = vodVideoFixture({ title: 'Menu popover', pageTitle: 'Menu popover fixture' });

describe('settings menu under the pointer', () => {
  for (const engine of testEngines()) {
    const shared = sharedTestBrowser(({ chromium, firefox })[engine]);

    it(`stays open while the pointer changes one option after another in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      await serveFixture(page, FIXTURE);
      await bootPlayer(page, { settings: { keepControlsVisible: false } });
      await page.waitForFunction(() => Boolean(document.querySelector('video')?.readyState && document.querySelector('video')!.readyState >= 2));
      await enterTheater(page);
      const menuOpen = () => page.evaluate(() => {
        const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
        return root.querySelector('.theater-settings-container')!.classList.contains('is-open')
          && root.querySelector('.theater-settings-menu')!.classList.contains('visible');
      });

      await page.locator('.player-settings-btn').click();
      assert.equal(await menuOpen(), true, 'a click pins the menu open');
      // The Layout row keeps focus after its click; each later press then moves focus away from it: to another
      // row, to nowhere (a stepper row's label is not focusable), or to nowhere again when Pin blurs itself.
      for (const target of ['.picture-layout-btn', '.video-fit-btn .theater-settings-label', '.controls-visibility-toggle',
        '.video-fit-btn .theater-stepper-btn[data-direction="1"]', '.picture-layout-btn', '.controls-visibility-toggle']) {
        await page.locator(target).click();
        assert.equal(await menuOpen(), true, `the menu stays open after clicking ${target}`);
      }

      await page.mouse.click(640, 200);
      assert.equal(await menuOpen(), false, 'a press outside still closes it');
    });
  }
});
