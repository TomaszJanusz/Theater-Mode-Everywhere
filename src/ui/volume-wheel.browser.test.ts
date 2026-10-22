import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { bootPlayer, enterTheater } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';
import { canvasVideoFixture, vodVideoFixture, serveFixture } from '../test-utils/video-fixtures';

const POINTER_FIXTURE = vodVideoFixture({ title: 'Slider pointer regression' });
const THUMB = 12;

const FIXTURE = canvasVideoFixture({ title: 'Wheel volume regression', pageTitle: 'Wheel volume fixture' });

/**
 * Starts theater mode on a playing local video.
 * @param page Browser page containing the local video fixture.
 * @returns When the theater controls have mounted and playback has started.
 */
async function boot(page: Page, settings: Record<string, unknown> = {}): Promise<void> {
  await bootPlayer(page, {
    settings: { keepControlsVisible: true, shortcuts: { playPause: 'k' }, ...settings },
    mainWorld: Boolean(settings.volumeBoostEnabled)
  });
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return Boolean(video && video.readyState >= 2 && !video.paused);
  });
  await enterTheater(page);
}

/**
 * Waits until exactly one playback HUD is showing the expected label.
 * @param page Theater page under test.
 * @param text Expected HUD label.
 * @returns When the overlay is present and not fading out.
 */
async function waitForHud(page: Page, text: string): Promise<void> {
  await page.waitForFunction((expected) => {
    const nodes = document.querySelector('#theater-everywhere-ui')?.shadowRoot
      ?.querySelectorAll('.theater-everywhere-volume-overlay') ?? [];
    if (nodes.length !== 1) return false;
    const overlay = nodes[0];
    const label = overlay.querySelector('.volume-hud-text')?.textContent;
    return label === expected && !overlay.classList.contains('fade-out');
  }, text);
}

/**
 * Counts wheel events reaching the volume container so a test can wait for each delivery.
 * @param page Theater page under test (with `page.clock` installed).
 * @returns A function that scrolls one gesture, separated from earlier ones, and awaits delivery.
 */
async function countWheelDelivery(page: Page): Promise<(delta: number) => Promise<void>> {
  // Count delivery, including sub-notch input which intentionally has no HUD.
  await page.locator('.volume-btn').evaluate(button => {
    const container = button.parentElement!;
    container.setAttribute('data-wheel-count', '0');
    container.addEventListener('wheel', () => {
      container.setAttribute('data-wheel-count', String(Number(container.getAttribute('data-wheel-count')) + 1));
    }, true);
  });
  return async delta => {
    // Separate notches from the deterministic continuous-gesture checks.
    await page.clock.runFor(251);
    const container = page.locator('.theater-volume-container');
    const count = Number(await container.getAttribute('data-wheel-count'));
    await page.mouse.wheel(0, delta);
    await page.waitForFunction(expected => document.querySelector('#theater-everywhere-ui')?.shadowRoot
      ?.querySelector('.theater-volume-container')?.getAttribute('data-wheel-count') === String(expected), count + 1);
  };
}

describe('wheel volume browser regressions', () => {
  for (const engine of testEngines()) {
    const shared = sharedTestBrowser(({ chromium, firefox })[engine]);
    it(`shares keyboard volume behavior and disposes wheel gestures in ${engine}`, { timeout: 60_000 }, async t => {
      const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 800 } })).newPage();
      await serveFixture(page, FIXTURE, 'http://wheel-volume.test/');
      await boot(page, { volumeBoostEnabled: true });
      await page.keyboard.press('ArrowUp');
      await page.clock.install();
      const speaker = page.locator('.volume-btn');
      const slider = page.locator('.theater-volume-slider');
      const setVolume = async (value: string) => {
        await slider.evaluate((input: HTMLInputElement, value) => {
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
      };
      const wheel = await countWheelDelivery(page);
      await setVolume('0.5');
      await speaker.hover();
      assert.equal(await speaker.evaluate(button => getComputedStyle(button).cursor), 'ns-resize');
      assert.equal(await slider.evaluate(input => getComputedStyle(input).cursor), 'ns-resize');
      for (const control of [speaker, slider]) {
        await control.evaluate(element => { (element as HTMLButtonElement | HTMLInputElement).disabled = true; });
        assert.notEqual(await control.evaluate(element => getComputedStyle(element).cursor), 'ns-resize');
        assert.notEqual(await page.locator('.theater-volume-container').evaluate(element => getComputedStyle(element).cursor), 'ns-resize');
        assert.equal(await control.evaluate(element => element.dispatchEvent(new WheelEvent('wheel', {
          deltaY: -120, bubbles: true, cancelable: true
        }))), true, 'disabled volume controls do not consume gestures');
        await control.evaluate(element => { (element as HTMLButtonElement | HTMLInputElement).disabled = false; });
      }
      const scroll = await page.evaluate(() => scrollY);
      await wheel(-120);
      await waitForHud(page, '55%');
      assert.equal(await slider.inputValue(), '0.55');
      await wheel(120);
      await waitForHud(page, '50%');
      assert.equal(await page.evaluate(() => scrollY), scroll);
      await slider.hover();
      await wheel(-120);
      await waitForHud(page, '55%');
      await wheel(120);
      await waitForHud(page, '50%');
      await page.clock.runFor(251);
      const smallWheel = (deltas: number[]) => slider.evaluate((input, deltas) => {
        const values: string[] = [];
        for (const deltaY of deltas) {
          input.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }));
          values.push((input as HTMLInputElement).value);
        }
        return values;
      }, deltas);
      assert.deepEqual(await smallWheel([-25, -25, -25, -25]), ['0.5', '0.5', '0.5', '0.55']);
      await smallWheel([-50]);
      await page.clock.runFor(251);
      assert.deepEqual(await smallWheel([-50, -50]), ['0.55', '0.6'], 'idle resets the remainder');
      // Leave native browser zoom out of subsequent pointer geometry checks.
      assert.equal(await slider.evaluate(input => input.dispatchEvent(new WheelEvent('wheel', {
        deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true
      }))), true, 'pinch/ctrl-wheel remains available to the browser');
      assert.equal(await slider.inputValue(), '0.6');
      await wheel(-10000);
      await waitForHud(page, '65%');
      // A drag cannot jump over 100%, so pass through it before boosting.
      await setVolume('1.5');
      assert.equal(await slider.inputValue(), '1');
      await setVolume('1.5');
      await wheel(-120);
      await waitForHud(page, '300%');
      assert.equal(await slider.inputValue(), '1.5');
      await wheel(120);
      await waitForHud(page, '280%');
      await setVolume('0');
      assert.equal(await slider.inputValue(), '1', 'a drag down also stops at 100%');
      await setVolume('0');
      await wheel(120);
      await waitForHud(page, '0%');
      await wheel(-120);
      await waitForHud(page, '5%');
      await speaker.click();
      await speaker.hover();
      await wheel(-120);
      await waitForHud(page, '10%');
      assert.equal(await page.locator('video').evaluate(video => (video as HTMLVideoElement).muted), false);
      // Alternate units and shared-container gap take exactly one step.
      for (const deltaMode of [1, 2]) {
        await page.locator('.theater-volume-container').dispatchEvent('wheel', { deltaY: deltaMode === 1 ? -3 : -1, deltaMode });
      }
      await waitForHud(page, '20%');
      await page.mouse.move(900, 100);
      await page.mouse.wheel(0, -100);
      await page.evaluate(() => new Promise(requestAnimationFrame));
      assert.equal(await slider.inputValue(), '0.2', 'wheel outside volume controls is unchanged');
      // Retain detached controls to prove scope cleanup rather than just removal.
      await speaker.evaluate(button => {
        Reflect.set(window, 'retiredVolume', button.parentElement);
      });
      await page.locator('.close-btn').click();
      await page.locator('.theater-controls-wrapper').waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => {
        const container = Reflect.get(window, 'retiredVolume') as HTMLElement;
        return Array.from(container.querySelectorAll('.volume-btn, input')).every(target =>
          target.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })));
      }), true, 'retired listeners no longer cancel wheel input');
      await page.keyboard.press('t');
      await page.locator('.theater-controls-wrapper.visible').waitFor();
      assert.equal(await page.locator('.theater-volume-slider').inputValue(), '0.2');
    });

    for (const boost of [false, true]) {
      it(`stops at 100% in both directions ${boost ? 'with' : 'without'} volume boost in ${engine}`, { timeout: 60_000 }, async t => {
        const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 800 } })).newPage();
        await serveFixture(page, FIXTURE, 'http://wheel-volume.test/');
        await boot(page, { volumeBoostEnabled: boost });
        await page.clock.install();
        const slider = page.locator('.theater-volume-slider');
        await page.locator('.volume-btn').hover();
        const wheel = await countWheelDelivery(page);
        // 5% steps survive off-grid values, then 100% is mandatory before anything above it.
        await slider.evaluate((input: HTMLInputElement) => {
          input.value = '0.9';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await wheel(-120);
        await waitForHud(page, '95%');
        await wheel(-120);
        await waitForHud(page, '100%');
        assert.equal(await slider.inputValue(), '1');
        await wheel(-120);
        if (boost) {
          await waitForHud(page, '120%');
          assert.equal(await slider.inputValue(), '1.05');
          await wheel(120);
          await waitForHud(page, '100%');
          assert.equal(await slider.inputValue(), '1');
        } else {
          await waitForHud(page, '100%');
          assert.equal(await slider.inputValue(), '1', 'without boost the level stays at 100%');
        }
        await wheel(120);
        await waitForHud(page, '95%');
      });
    }
    for (const [name, button, selector, press, drag] of [
      ['speed', '.speed-btn', '.theater-speed-slider', { fraction: 5 / 7, value: '5' }, { fraction: 1 / 7, value: '1' }],
      ['volume', '.volume-btn', '.theater-volume-slider', { fraction: 0.5, value: '0.75' }, { fraction: 0.2, value: '0.3' }]
    ] as const) {
      it(`takes a press beside the ${name} track and drags from there in ${engine}`, { timeout: 60_000 }, async t => {
        const page = await (await shared.newContext(t, { viewport: { width: 1280, height: 800 } })).newPage();
        await serveFixture(page, POINTER_FIXTURE, 'http://slider-marker.test/');
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
      await serveFixture(page, POINTER_FIXTURE, 'http://slider-marker.test/');
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
