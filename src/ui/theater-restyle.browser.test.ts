import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { Page } from 'playwright';

import { sharedEngineBrowsers } from '../test-utils/engine-browsers';
import { bootPlayer } from '../test-utils/player-boot';
import { testEngines } from '../test-utils/test-engines';
import { canvasVideoFixture, serveFixture } from '../test-utils/video-fixtures';

// Theater classes and custom properties on <html>/<body> restyle the whole host page. A layout
// read after such a write forces that restyle inside the key handler, which on a large page like
// YouTube costs tens of milliseconds each. Entry and exit should pay it only where a measurement
// depends on the page-wide state.

const FIXTURE = canvasVideoFixture({ title: 'Theater restyle' });

interface Toggle {
  /** Layout reads that followed a changed page-wide class or inline style, with their caller. */
  forced: string[];
  /** Synthetic window resizes dispatched while the key was handled. */
  resizes: number;
  theater: boolean;
  controls: boolean;
}

/** Wraps page-wide writes and layout reads; only records while a toggle is being handled. */
function instrument(page: Page): Promise<void> {
  return page.evaluate(() => {
    const state = { armed: false, dirty: false, forced: [] as string[], resizes: 0, total: 0 };
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
          if (value(this) !== before) state.dirty = true;
          return result;
        };
      }
    };
    wrapWrite(CSSStyleDeclaration.prototype, ['setProperty', 'removeProperty'], pageStyle, style => style.cssText);
    wrapWrite(DOMTokenList.prototype, ['add', 'remove', 'toggle', 'replace'], pageClasses, list => list.value);
    const read = (name: string) => {
      if (!state.armed) return;
      if (state.dirty) state.forced.push(`${name} ${new Error().stack?.split('\n').slice(2, 5).join(' < ') ?? ''}`);
      state.dirty = false;
    };
    for (const name of ['getBoundingClientRect', 'getClientRects'] as const) {
      const native = Element.prototype[name] as (this: Element) => unknown;
      (Element.prototype as unknown as Record<string, unknown>)[name] = function (this: Element) { read(name); return native.call(this); };
    }
    const nativeShow = HTMLElement.prototype.showPopover;
    HTMLElement.prototype.showPopover = function (this: HTMLElement) { read('showPopover'); return nativeShow.call(this); };
    const nativeComputed = window.getComputedStyle;
    window.getComputedStyle = function (element: Element, pseudo?: string | null) { read('getComputedStyle'); return nativeComputed.call(window, element, pseudo); };
    const getters: Array<[object, string[]]> = [
      [HTMLElement.prototype, ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'offsetParent']],
      [Element.prototype, ['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight', 'scrollTop', 'scrollLeft']]
    ];
    for (const [proto, names] of getters) for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name)!;
      Object.defineProperty(proto, name, { ...descriptor, get(this: Element) { read(name); return descriptor.get!.call(this); } });
    }
    window.addEventListener('resize', () => { state.total++; if (state.armed) state.resizes++; }, true);
  });
}

/** Dispatches the theater key and reports what the handler did before returning. */
function toggle(page: Page): Promise<Toggle> {
  return page.evaluate(() => {
    const state = (window as unknown as { __restyle: { armed: boolean; dirty: boolean; forced: string[]; resizes: number } }).__restyle;
    Object.assign(state, { armed: true, dirty: false, forced: [], resizes: 0 });
    try {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', code: 'KeyT', bubbles: true, cancelable: true }));
    } finally {
      state.armed = false;
    }
    return {
      forced: state.forced,
      resizes: state.resizes,
      theater: document.documentElement.classList.contains('theater-everywhere-html-active'),
      controls: Boolean(document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector('.theater-controls-wrapper'))
    };
  });
}

const browsers = sharedEngineBrowsers();

for (const engine of testEngines()) {
  it(`${engine}: the theater key builds and removes the player without restyling the page between reads`, { timeout: 60_000 }, async t => {
    const page = await (await browsers[engine].newContext(t, { viewport: { width: 1280, height: 800 } })).newPage();
    await serveFixture(page, FIXTURE, 'http://theater-restyle.test/');
    await bootPlayer(page, { mainWorld: true });
    await page.waitForFunction(() => { const v = document.querySelector('video'); return Boolean(v && v.readyState >= 2 && !v.paused); });
    await instrument(page);
    // The runtime ignores the key for 200 ms after a toggle; the test clock ends that window.
    await page.clock.install();

    for (let cycle = 0; cycle < 2; cycle++) {
      const enter = await toggle(page);
      // The whole player exists when the key handler returns, so the next frame is never a partial player.
      assert.equal(enter.theater, true);
      assert.equal(enter.controls, true);
      // Page classes, chat geometry and caption style are written before the first read; the picture
      // layout and caption dock then each depend on one measurement of the restyled page.
      assert.ok(enter.forced.length <= 2, `entry forced ${enter.forced.length} page restyles:\n${enter.forced.join('\n')}`);
      await page.locator('.theater-controls-wrapper.visible').waitFor();
      await page.clock.runFor(250);

      const resized = await page.evaluate(() => (window as unknown as { __restyle: { total: number } }).__restyle.total);
      const exit = await toggle(page);
      assert.equal(exit.theater, false);
      assert.deepEqual(exit.forced, [], 'exit reads no layout after restoring the page');
      // The host relayout waits for the frame instead of making the host lay out the page in the handler.
      assert.equal(exit.resizes, 0);
      await page.waitForFunction(count => (window as unknown as { __restyle: { total: number } }).__restyle.total > count, resized);
      await page.clock.runFor(250);
    }
  });
}
