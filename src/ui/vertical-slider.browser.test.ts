import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { bootPlayer, enterTheater } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';
import { vodVideoFixture, serveFixture } from '../test-utils/video-fixtures';

const FIXTURE = vodVideoFixture({ title: 'Slider marker regression', pageTitle: 'Slider marker fixture' });
const THUMB = 12;

/**
 * Where a slider's thumb centre sits and where its marker sits, in page pixels from the bottom
 * of the rotated track. They agree when the marker is on the thumb's path for `markerValue`.
 */
async function markerOffsets(page: Page, sliderSelector: string, markerValue: number) {
  return page.evaluate(([selector, value, thumb]) => {
    const root = document.querySelector('#theater-everywhere-ui')!.shadowRoot!;
    const slider = root.querySelector<HTMLInputElement>(selector as string)!;
    const marker = root.querySelector<HTMLElement>(`${selector} ~ .theater-slider-marker`)!;
    slider.value = String(value);
    const track = slider.getBoundingClientRect();
    const dot = marker.getBoundingClientRect();
    const fraction = (Number(slider.value) - Number(slider.min)) / (Number(slider.max) - Number(slider.min));
    return {
      hidden: marker.hidden || dot.width === 0,
      thumbCentre: track.bottom - (thumb as number) / 2 - fraction * (track.height - (thumb as number)),
      markerCentre: dot.top + dot.height / 2,
      markerWidth: dot.width,
      markerHeight: dot.height,
      markerX: dot.left + dot.width / 2,
      trackX: track.left + track.width / 2
    };
  }, [sliderSelector, markerValue, THUMB] as const);
}

describe('vertical slider marker', () => {
  for (const engine of testEngines()) {
    const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
    for (const boost of [false, true]) {
      it(`sits on the thumb path for 1x and 100%${boost ? ' with the boost ceiling' : ''} in ${engine}`, { timeout: 60_000 }, async t => {
        const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 800 } })).newPage();
        await serveFixture(page, FIXTURE, 'http://slider-marker.test/');
        await bootPlayer(page, {
          settings: { keepControlsVisible: true, volumeBoostEnabled: boost },
          mainWorld: boost
        });
        await enterTheater(page);
        // Closed panels have no geometry; hover opens both in turn.
        await page.locator('.speed-btn').hover();
        const speed = await markerOffsets(page, '.theater-speed-slider', 3);
        assert.equal(speed.hidden, false);
        assert.ok(Math.abs(speed.markerCentre - speed.thumbCentre) < 0.75, `1x marker ${JSON.stringify(speed)}`);
        assert.ok(Math.abs(speed.markerX - speed.trackX) < 0.75);

        await page.locator('.volume-btn').hover();
        const volume = await markerOffsets(page, '.theater-volume-slider', 1);
        if (boost) {
          assert.equal(volume.hidden, false);
          assert.ok(Math.abs(volume.markerCentre - volume.thumbCentre) < 0.75, `100% marker ${JSON.stringify(volume)}`);
          assert.ok(Math.abs(volume.markerX - volume.trackX) < 0.75);
          // One marker shape for every slider.
          assert.deepEqual([volume.markerWidth, volume.markerHeight], [speed.markerWidth, speed.markerHeight]);
        } else {
          assert.equal(volume.hidden, true, '100% is the end of the track, so it carries no marker');
        }
      });
    }

    for (const [name, button, selector, press, drag] of [
      ['speed', '.speed-btn', '.theater-speed-slider', { fraction: 5 / 7, value: '5' }, { fraction: 1 / 7, value: '1' }],
      ['volume', '.volume-btn', '.theater-volume-slider', { fraction: 0.5, value: '0.75' }, { fraction: 0.2, value: '0.3' }]
    ] as const) {
      it(`takes a press beside the ${name} track and drags from there in ${engine}`, { timeout: 60_000 }, async t => {
        const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 800 } })).newPage();
        await serveFixture(page, FIXTURE, 'http://slider-marker.test/');
        await bootPlayer(page, { settings: { keepControlsVisible: true, volumeBoostEnabled: true }, mainWorld: true });
        await enterTheater(page);
        await page.locator(button).hover();
        const slider = page.locator(selector);
        await slider.waitFor({ state: 'visible' });
        const track = (await slider.boundingBox())!;
        const x = track.x + track.width / 2;
        const yAt = (fraction: number) => track.y + track.height - THUMB / 2 - fraction * (track.height - THUMB);
        const before = await slider.inputValue();
        // In the panel padding, beyond the 32px hit column: nothing moves.
        await page.mouse.click(x + 20, yAt(0.9));
        assert.equal(await slider.inputValue(), before);
        // Ten pixels off the 6px track still jumps the thumb, then keeps dragging, even off the column.
        await page.mouse.move(x + 10, yAt(press.fraction));
        await page.mouse.down();
        assert.equal(await slider.inputValue(), press.value);
        await page.mouse.move(x + 40, yAt(drag.fraction), { steps: 3 });
        assert.equal(await slider.inputValue(), drag.value);
        await page.mouse.up();
        assert.equal(await slider.inputValue(), drag.value);
        // Focus and the label stay on the input; the popover stays open for the press.
        assert.equal(await slider.evaluate(input => input.getRootNode() instanceof ShadowRoot
          && (input.getRootNode() as ShadowRoot).activeElement === input), true);
        assert.ok(await slider.getAttribute('aria-valuetext'));
        assert.equal(await slider.evaluate(input => (input.closest('[inert]') as HTMLElement | null) === null), true);
      });
    }

    it(`hides a pointer-focused slider panel 5 s after the pointer leaves, keeping keyboard focus in ${engine}`, { timeout: 90_000 }, async t => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 800 } })).newPage();
      await serveFixture(page, FIXTURE, 'http://slider-marker.test/');
      await bootPlayer(page, { settings: { keepControlsVisible: true, volumeBoostEnabled: true }, mainWorld: true });
      await enterTheater(page);
      // The fake clock still ticks in real time, so "before 5 s" checks keep seconds of slack.
      await page.clock.install();
      const slider = page.locator('.theater-volume-slider');
      const focused = () => slider.evaluate(input => (input.getRootNode() as ShadowRoot).activeElement === input);
      const inert = () => page.locator('.theater-volume-panel').evaluate(panel => (panel as HTMLElement).inert);
      const dragAndLeave = async () => {
        await page.locator('.volume-btn').hover();
        await slider.waitFor({ state: 'visible' });
        const track = (await slider.boundingBox())!;
        await page.mouse.move(track.x + track.width / 2, track.y + track.height / 2);
        await page.mouse.down();
        await page.mouse.move(track.x + track.width / 2, track.y + track.height / 3, { steps: 3 });
        // An active drag never hides the panel, even when the pointer is far away.
        await page.mouse.move(640, 200);
        await page.clock.runFor(6000);
        assert.equal(await focused(), true, 'a held drag keeps the panel');
        await page.mouse.up();
      };

      await dragAndLeave();
      await page.clock.runFor(3000);
      assert.equal(await focused(), true, 'still open before 5 s');
      // Re-entering cancels the timer; leaving again starts a fresh 5 s.
      await page.locator('.volume-btn').hover();
      await page.clock.runFor(6000);
      assert.equal(await focused(), true, 'hovering keeps the panel');
      await page.mouse.move(640, 300);
      await page.clock.runFor(3000);
      assert.equal(await focused(), true);
      await page.clock.runFor(3000);
      assert.equal(await focused(), false, 'blurred after 5 s');
      assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.tagName), 'BODY', 'focus is not moved elsewhere');
      assert.equal(await inert(), true);

      // The picture click right after the hide still toggles playback (hidden chrome is not "open").
      await page.clock.runFor(2000);
      const video = page.locator('video');
      const paused = await video.evaluate((v: HTMLVideoElement) => v.paused);
      await page.mouse.click(640, 300);
      await page.waitForFunction(was => document.querySelector('video')!.paused !== was, paused);

      // Keyboard-reached focus has no timer.
      await page.locator('.volume-btn').hover();
      await slider.focus();
      await page.keyboard.press('ArrowUp');
      await page.mouse.move(640, 200);
      await page.clock.runFor(30_000);
      assert.equal(await focused(), true, 'keyboard focus stays until Escape or blur');
    });
  }
});
