import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { bootPlayer, enterTheater } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';
import { canvasVideoFixture, serveFixture } from '../test-utils/video-fixtures';

// Pointer use must never leave focus, or its keyboard ring, on a bar control. The subtitle menu is where it
// did: with a long language list it focuses its search field, and closing it moved focus to the CC button.
// A focused text field makes a script focus() count as keyboard focus, so the button showed the ring that
// W/A/S/D navigation draws, and kept it (and the focus) across the bar hiding and showing again.

const FIXTURE = canvasVideoFixture({ title: 'CC focus' });
/** Long enough for the menu's search field to show. */
const LANGUAGES = 12;
const VIEWPORT = { width: 1280, height: 720 };

const ccButton = (page: Page) => page.locator('.cc-btn');
const focusOnBar = (page: Page) => page.evaluate(() => {
  const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
  return { active: root.activeElement?.className ?? null, ringed: [...root.querySelectorAll(':focus-visible')].map(element => element.className) };
});
const NO_FOCUS = { active: null, ringed: [] };

async function pointAt(page: Page, selector: string): Promise<void> {
  const box = (await page.locator(selector).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
}

describe('subtitle menu focus', () => {
  for (const engine of testEngines()) {
    const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
    const open = async (t: Parameters<typeof shared.newContext>[0]) => {
      const page = await (await shared.newContext(t, { viewport: VIEWPORT })).newPage();
      await serveFixture(page, FIXTURE);
      await page.evaluate(count => {
        const video = document.querySelector('video')!;
        for (let index = 0; index < count; index++) {
          const track = video.addTextTrack('subtitles', `Language ${index}`, `l${index}`);
          track.addCue(new VTTCue(0, 3600, 'Line'));
          track.mode = 'disabled';
        }
      }, LANGUAGES);
      await bootPlayer(page, { settings: { keepControlsVisible: false } });
      await page.clock.install();
      await enterTheater(page);
      return page;
    };
    const hideBar = async (page: Page) => {
      await page.mouse.move(640, 300);
      await page.clock.runFor(4000);
      assert.equal(await page.locator('.theater-controls-wrapper.visible').count(), 0, 'the bar auto-hid');
    };

    it(`hovering the player after a key press focuses nothing in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await open(t);
      await page.keyboard.press('Shift');
      await hideBar(page);
      await page.mouse.move(660, 320, { steps: 3 });
      await page.locator('.theater-controls-wrapper.visible').waitFor();
      assert.deepEqual(await focusOnBar(page), NO_FOCUS);
    });

    it(`hovering the subtitle button and leaving it leaves no focus or ring behind in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await open(t);
      await pointAt(page, '.cc-btn');
      await page.locator('.theater-cc-menu-host.is-open').waitFor();
      assert.deepEqual(await focusOnBar(page), NO_FOCUS, 'hover only reveals the menu');
      await page.mouse.move(640, 300, { steps: 4 });
      await page.clock.runFor(500);
      assert.deepEqual(await focusOnBar(page), NO_FOCUS, 'leaving the menu focuses nothing');
      // The old state survived the bar hiding and showed on the next plain hover over the picture.
      await hideBar(page);
      await page.mouse.move(660, 320, { steps: 3 });
      await page.locator('.theater-controls-wrapper.visible').waitFor();
      assert.deepEqual(await focusOnBar(page), NO_FOCUS);
    });

    it(`clicking the subtitle button and letting the bar hide leaves no focus or ring behind in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await open(t);
      await page.keyboard.press('Shift');
      await ccButton(page).click();
      await page.locator('.theater-cc-menu .theater-cc-search-input').waitFor();
      assert.equal((await focusOnBar(page)).active, 'theater-cc-search-input', 'a click opens the menu on its search field');
      await page.mouse.move(640, 300, { steps: 4 });
      await page.clock.runFor(4000);
      assert.equal(await page.locator('.theater-controls-wrapper.visible').count(), 0, 'the bar auto-hid and closed the menu');
      assert.deepEqual(await focusOnBar(page), NO_FOCUS);
      await page.mouse.move(660, 320, { steps: 3 });
      await page.locator('.theater-controls-wrapper.visible').waitFor();
      assert.deepEqual(await focusOnBar(page), NO_FOCUS);
    });

    it(`W/A/S/D still reaches the subtitle menu and a keyboard pick returns to its button in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await open(t);
      await hideBar(page);
      await page.keyboard.press('w');
      assert.ok((await focusOnBar(page)).active?.includes('player-settings-btn'), 'W focuses the settings button');
      for (let step = 0; step < 12 && !(await focusOnBar(page)).active?.includes('cc-btn'); step++) await page.keyboard.press('a');
      assert.ok((await focusOnBar(page)).active?.includes('cc-btn'), 'A reaches the subtitle button');
      assert.ok((await focusOnBar(page)).ringed.some(name => name.includes('cc-btn')), 'keyboard focus shows its ring');
      await page.keyboard.press('w');
      assert.ok((await focusOnBar(page)).active?.includes('theater-cc-menu-item'), 'W enters the menu on a row');
      await page.keyboard.press('Enter');
      await page.clock.runFor(500);
      assert.equal(await page.locator('.theater-cc-menu-host.is-open').count(), 0, 'Enter picked the language and closed the menu');
      const after = await focusOnBar(page);
      assert.ok(after.active?.includes('cc-btn') && after.ringed.some(name => name.includes('cc-btn')), `the keyboard user stays on the button: ${JSON.stringify(after)}`);
    });
  }
});
