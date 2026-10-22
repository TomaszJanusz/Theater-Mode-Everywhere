import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { bootPlayer, enterTheater } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';
import { serveFixture, vodVideoFixture } from '../test-utils/video-fixtures';

const FIXTURE = vodVideoFixture({ title: 'Navigation', pageTitle: 'Navigation fixture' });

type Init = { key: string; code: string; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; isComposing?: boolean };
/** What a physical key produces on a layout: the printed `key` for a position (`code`). */
const QWERTY = { w: { key: 'w', code: 'KeyW' }, a: { key: 'a', code: 'KeyA' }, s: { key: 's', code: 'KeyS' }, d: { key: 'd', code: 'KeyD' } };
// AZERTY prints Z, Q, S, D on the W, A, S, D positions, and W on the Z position.
const AZERTY = { w: { key: 'z', code: 'KeyW' }, a: { key: 'q', code: 'KeyA' }, s: { key: 's', code: 'KeyS' }, d: { key: 'd', code: 'KeyD' } };

async function boot(page: Page, settings: Record<string, unknown> = {}): Promise<void> {
  await serveFixture(page, FIXTURE);
  await bootPlayer(page, { settings: { keepControlsVisible: false, ...settings } });
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return Boolean(video && video.readyState >= 2 && Number.isFinite(video.duration));
  });
  await page.evaluate(() => { document.querySelector('video')!.pause(); });
  // Records what reaches the page after the player's own handlers: nothing consumed means the page still sees it.
  await page.evaluate(() => {
    const seen: Array<{ code: string; prevented: boolean }> = [];
    Object.assign(window, { pageKeys: seen });
    document.addEventListener('keydown', event => { seen.push({ code: event.code, prevented: event.defaultPrevented }); });
  });
}

/** Dispatches a keydown the way a keyboard layout would produce it, and returns whether the player consumed it. */
const press = (page: Page, init: Init) => page.evaluate(init => {
  const target = document.activeElement ?? document;
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, composed: true, ...init });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}, init);

/** The focused control inside the player UI, named by its classes. */
const focused = (page: Page) => page.evaluate(() => {
  const root = document.getElementById('theater-everywhere-ui')?.shadowRoot;
  const active = root?.activeElement;
  return active ? { classes: [...active.classList], inMenu: Boolean(active.closest('.theater-settings-menu')), row: active.closest('.theater-settings-row')?.className ?? '' } : null;
});
const barVisible = (page: Page) => page.evaluate(() => Boolean(document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-controls-wrapper.visible')));
const pageKeys = (page: Page) => page.evaluate(() => (window as unknown as { pageKeys: Array<{ code: string; prevented: boolean }> }).pageKeys.splice(0));
const fitValue = (page: Page) => page.evaluate(() => document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.video-fit-btn .theater-stepper-value')!.textContent);

describe('player bar navigation', () => {
  for (const engine of testEngines()) {
    const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
    const open = async (t: Parameters<typeof shared.newContext>[0], settings?: Record<string, unknown>) => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      await boot(page, settings);
      // Before entering, so the bar's auto-hide timer is the fake one.
      await page.clock.install();
      await enterTheater(page);
      return page;
    };

    it(`W opens the bar on the settings button, moves in four directions, steps a row and ends cleanly in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await open(t);
      await page.clock.runFor(3000);
      assert.equal(await barVisible(page), false, 'the bar auto-hid');

      assert.equal(await press(page, QWERTY.w), true);
      assert.equal(await barVisible(page), true);
      assert.ok((await focused(page))?.classes.includes('player-settings-btn'), 'W focuses the settings button');

      // Sideways along the bar and back.
      await press(page, QWERTY.a);
      const left = await focused(page);
      assert.ok(left && !left.classes.includes('player-settings-btn'), 'A moves left');
      await press(page, QWERTY.d);
      assert.ok((await focused(page))?.classes.includes('player-settings-btn'), 'D moves back');

      // Up from the gear opens its menu and focuses its first row; S moves down inside it.
      await press(page, QWERTY.w);
      const first = await focused(page);
      assert.ok(first?.inMenu, 'W opens the menu');
      await press(page, QWERTY.s);
      assert.notDeepEqual(await focused(page), first, 'S moves down inside the menu');

      // Down to the Video fit row: D raises, A lowers, neither wraps.
      for (let step = 0; step < 12 && !(await focused(page))?.row.includes('video-fit-btn'); step++) await press(page, QWERTY.s);
      assert.ok((await focused(page))?.row.includes('video-fit-btn'), 'S reaches the Video fit row');
      const start = await fitValue(page);
      await press(page, QWERTY.a);
      assert.equal(await fitValue(page), start, 'A at the first option changes nothing');
      await press(page, QWERTY.d);
      const raised = await fitValue(page);
      assert.notEqual(raised, start);
      await press(page, QWERTY.d);
      await press(page, QWERTY.d);
      const top = await fitValue(page);
      await press(page, QWERTY.d);
      assert.equal(await fitValue(page), top, 'D at the last option changes nothing');
      await press(page, QWERTY.a);
      assert.equal(await fitValue(page), raised, 'A lowers one step');

      // Escape closes the menu first, then ends the mode and leaves theater running.
      await page.keyboard.press('Escape');
      assert.ok((await focused(page))?.classes.includes('player-settings-btn'), 'Escape closes the menu onto the gear');
      await page.keyboard.press('Escape');
      assert.equal(await focused(page), null, 'a second Escape ends the mode');
      assert.equal(await page.locator('.theater-controls-wrapper').count(), 1, 'theater is still active');
      await pageKeys(page);
      // The mode is over: A/D are the page's again.
      assert.equal(await press(page, QWERTY.a), false);
      assert.deepEqual(await pageKeys(page), [{ code: 'KeyA', prevented: false }]);
      await page.clock.runFor(3000);
      assert.equal(await barVisible(page), false, 'the bar hides on its own after the mode ends');
    });

    it(`S on the bar's last row hides the bar and returns the keys to the player in ${engine}`, { timeout: 30_000 }, async t => {
      const page = await open(t);
      await press(page, QWERTY.w);
      assert.ok((await focused(page))?.classes.includes('player-settings-btn'));
      assert.equal(await press(page, QWERTY.s), true);
      assert.equal(await barVisible(page), false, 'S hid the bar at once');
      assert.equal(await focused(page), null);
      await pageKeys(page);
      assert.equal(await press(page, QWERTY.d), false, 'D is no longer navigation');
      assert.deepEqual(await pageKeys(page), [{ code: 'KeyD', prevented: false }]);
    });

    it(`matches the physical key on AZERTY and QWERTZ, and ignores modifiers, composition and editable fields in ${engine}`, { timeout: 40_000 }, async t => {
      const page = await open(t);
      const leaves = () => page.keyboard.press('Escape');

      // AZERTY: the W position prints Z; the Z position prints W and must not start anything.
      assert.equal(await press(page, { key: 'w', code: 'KeyZ' }), false, 'the printed W on the Z position is not navigation');
      assert.equal(await focused(page), null);
      assert.equal(await press(page, AZERTY.w), true, 'the W position starts the mode whatever it prints');
      assert.ok((await focused(page))?.classes.includes('player-settings-btn'));
      await press(page, AZERTY.a);
      assert.ok(!(await focused(page))?.classes.includes('player-settings-btn'), 'the A position (printed Q) moves left');
      await press(page, AZERTY.d);
      assert.ok((await focused(page))?.classes.includes('player-settings-btn'), 'the D position moves right');
      await leaves();

      // QWERTZ swaps only Y and Z: the cluster is unmoved, and the swapped keys keep their other meanings.
      assert.equal(await press(page, { key: 'y', code: 'KeyZ' }), false);
      assert.equal(await focused(page), null);
      const fit = await fitValue(page);
      assert.equal(await press(page, { key: 'z', code: 'KeyY' }), true, 'the printed Z still cycles the video fit as before');
      assert.notEqual(await fitValue(page), fit);
      assert.equal(await press(page, QWERTY.w), true, 'W stays on the W position');
      await leaves();

      // Exact modifiers only, and never while composing.
      for (const modifier of ['shiftKey', 'altKey', 'ctrlKey', 'metaKey'] as const) {
        await press(page, { ...QWERTY.w, [modifier]: true });
        assert.equal(await focused(page), null, `${modifier}+W does not start the mode`);
      }
      assert.equal(await press(page, { ...QWERTY.w, isComposing: true }), false);
      assert.equal(await focused(page), null);

      // Typing in a page field is never captured.
      await page.evaluate(() => {
        const input = document.createElement('input');
        input.id = 'field';
        document.body.append(input);
        input.focus();
      });
      assert.equal(await press(page, QWERTY.w), false);
      assert.equal(await page.evaluate(() => Boolean(document.getElementById('theater-everywhere-ui')?.shadowRoot?.activeElement)), false);
    });

    it(`leaves the host page alone outside theater and honours reassigned keys in ${engine}`, { timeout: 30_000 }, async t => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      await boot(page, { shortcuts: { navigateUp: 'KeyI' } });
      assert.equal(await press(page, QWERTY.w), false, 'outside theater W is the page’s');
      assert.deepEqual(await pageKeys(page), [{ code: 'KeyW', prevented: false }]);
      await enterTheater(page);
      assert.equal(await press(page, QWERTY.w), false, 'W is no longer bound once reassigned');
      assert.equal(await press(page, { key: 'i', code: 'KeyI' }), true, 'the reassigned position starts the mode');
      assert.ok((await focused(page))?.classes.includes('player-settings-btn'));
      // Leaving theater drops the mode and its bar with it.
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.theater-controls-wrapper').count(), 0);
      await pageKeys(page);
      assert.equal(await press(page, { key: 'i', code: 'KeyI' }), false);
    });
  }
});
