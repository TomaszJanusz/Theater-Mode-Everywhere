import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { Page } from 'playwright';

import { CAPTION_DOCK_REST_BOTTOM } from '../media-features/caption-dock';
import { sharedEngineBrowsers } from '../test-utils/engine-browsers';
import { bootPlayer, enterTheater } from '../test-utils/player-boot';
import { testEngines } from '../test-utils/test-engines';
import { canvasVideoFixture, serveFixture } from '../test-utils/video-fixtures';


import { TOOLBAR_AUTO_HIDE_DELAY_MS } from './toolbar';

// A class or inline style change on <html>/<body> restyles the whole host page; on YouTube that is
// tens of milliseconds, and the bar's next layout read forced it inside the pointer or timer task.
// Showing the bar on a pointer move and hiding it after idle must leave the page-wide state alone.

const FIXTURE = canvasVideoFixture({ title: 'Toolbar restyle' });

/** Records page-wide class and inline-style changes, with their caller, while armed. */
function instrument(page: Page): Promise<void> {
  return page.evaluate(() => {
    const state = { armed: false, writes: [] as string[] };
    (window as unknown as { __restyle: typeof state }).__restyle = state;
    const pageStyle = (style: CSSStyleDeclaration) => style === document.documentElement.style || style === document.body.style;
    const pageClasses = (list: DOMTokenList) => list === document.documentElement.classList || list === document.body.classList;
    const wrapWrite = <T extends object>(proto: T, names: string[], owned: (self: T) => boolean, value: (self: T) => string) => {
      for (const name of names) {
        const native = (proto as Record<string, (...args: unknown[]) => unknown>)[name];
        (proto as Record<string, unknown>)[name] = function (this: T, ...args: unknown[]) {
          if (!state.armed || !owned(this)) return native.apply(this, args);
          const before = value(this);
          const result = native.apply(this, args);
          if (value(this) !== before) {
            state.writes.push(`${name}(${args.map(String).join(', ')}) ${new Error().stack?.split('\n').slice(2, 5).join(' < ') ?? ''}`);
          }
          return result;
        };
      }
    };
    wrapWrite(CSSStyleDeclaration.prototype, ['setProperty', 'removeProperty'], pageStyle, style => style.cssText);
    wrapWrite(DOMTokenList.prototype, ['add', 'remove', 'toggle', 'replace'], pageClasses, list => list.value);
  });
}

function arm(page: Page, armed: boolean): Promise<string[]> {
  return page.evaluate(value => {
    const state = (window as unknown as { __restyle: { armed: boolean; writes: string[] } }).__restyle;
    const writes = state.writes;
    Object.assign(state, { armed: value, writes: [] });
    return writes;
  }, armed);
}

/** The pointer cursor over the picture and the page behind it. */
function cursors(page: Page): Promise<{ picture: string; page: string; bar: boolean }> {
  return page.evaluate(() => ({
    picture: getComputedStyle(document.querySelector('video')!).cursor,
    page: getComputedStyle(document.body).cursor,
    bar: Boolean(document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-controls-wrapper.visible'))
  }));
}

/** The caption overlay's resting place above the screen's bottom edge, in pixels; it glides there in real time. */
function captionBottom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const overlay = document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-caption-overlay')!;
    return Number.parseFloat(getComputedStyle(overlay).getPropertyValue('--theater-caption-bottom'));
  });
}

const browsers = sharedEngineBrowsers();

for (const engine of testEngines()) {
  for (const [pinned, captions] of [[false, false], [true, false], [false, true]]) {
    const name = `${pinned ? 'pinned' : 'auto-hiding'} bar${captions ? ' over overlay captions' : ''}`;
    it(`${engine}: the ${name} shows and hides without restyling the page`, { timeout: 60_000 }, async t => {
      const page = await (await browsers[engine].newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
      await serveFixture(page, FIXTURE, 'http://toolbar-restyle.test/');
      await page.clock.install();
      await bootPlayer(page, { settings: { keepControlsVisible: pinned } });
      await page.waitForFunction(() => Boolean(document.querySelector('video')?.readyState && document.querySelector('video')!.readyState >= 2));
      await page.mouse.move(640, 300);
      await enterTheater(page);
      if (captions) {
        // The bar lifts the captions; their new bottom must not be written where the whole page inherits it.
        await page.evaluate(() => {
          const track = document.querySelector('video')!.addTextTrack('subtitles', 'Captions', 'en');
          track.addCue(new VTTCue(0, 3600, 'Captions clear the bar'));
          track.mode = 'hidden';
        });
        await page.keyboard.press('c');
        await page.locator('.theater-caption-overlay.visible').waitFor();
      }
      await page.clock.runFor(TOOLBAR_AUTO_HIDE_DELAY_MS + 100);
      await instrument(page);

      for (let cycle = 0; cycle < 2; cycle++) {
        await arm(page, true);
        await page.mouse.move(640 + (cycle % 2 ? 10 : 20), 300);
        await page.clock.runFor(200);
        assert.deepEqual(await arm(page, false), [], 'showing the bar wrote page-wide state');
        assert.deepEqual(await cursors(page), { picture: 'auto', page: 'auto', bar: true });
        if (captions) assert.ok(await captionBottom(page) > CAPTION_DOCK_REST_BOTTOM, 'the bar lifts the captions');

        await arm(page, true);
        await page.clock.runFor(TOOLBAR_AUTO_HIDE_DELAY_MS);
        if (captions) {
          // Captions stay clear of the bar until its fade, which runs in real time, has ended.
          await page.waitForFunction(() => getComputedStyle(document.getElementById('theater-everywhere-ui')!.shadowRoot!
            .querySelector('.theater-controls-wrapper')!).opacity === '0');
          await page.clock.runFor(100);
        }
        assert.deepEqual(await arm(page, false), [], 'hiding the bar wrote page-wide state');
        // Idle hides the pointer over the picture; the page behind the stage keeps its own.
        assert.deepEqual(await cursors(page), { picture: 'none', page: 'auto', bar: pinned });
        if (captions) assert.equal(await captionBottom(page), CAPTION_DOCK_REST_BOTTOM, 'the captions return to rest');
      }

      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
      assert.equal(await page.evaluate(() => document.querySelector('.theater-everywhere-cursor-hidden') === null
        && getComputedStyle(document.querySelector('video')!).cursor), 'auto', 'exit leaves the cursor hidden');
    });
  }
}
