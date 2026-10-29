import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { Page } from 'playwright';

import { sharedEngineBrowsers } from '../test-utils/engine-browsers';
import { bootPlayer, enterTheater } from '../test-utils/player-boot';
import { testEngines } from '../test-utils/test-engines';
import { canvasVideoFixture, serveFixture } from '../test-utils/video-fixtures';

// While a host such as YouTube rebuilds its page for the next video, a layout read pays for every DOM
// change the browser has not laid out yet: the host's own, and those of another player reader that
// wrote before it. On YouTube each costs a style recalculation of the page. The player's readers
// (playlist buttons, picture, caption dock, actions) share one read phase per frame that follows the
// frame's own layout, so a host change costs them no forced restyle at all.

const FIXTURE = canvasVideoFixture({ title: 'Navigation restyle' });

type Restyle = { __restyle: { armed: boolean; forced: string[] } };

/**
 * Records layout reads made while the DOM has changed since the browser last laid it out. A probe
 * element resized every frame marks each layout: its resize observer is created before the player's,
 * so it is delivered first, right after the frame's style and layout.
 */
function instrument(page: Page): Promise<void> {
  return page.evaluate(() => {
    const state = { armed: false, forced: [] as string[] };
    (window as unknown as Restyle).__restyle = state;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;opacity:0';
    document.documentElement.append(probe);
    let changed = false;
    const ownRecord = (record: MutationRecord) => record.target === probe;
    const changes = new MutationObserver(records => { if (!records.every(ownRecord)) changed = true; });
    const options = { subtree: true, childList: true, attributes: true, characterData: true };
    changes.observe(document, options);
    const pending = () => {
      if (!changes.takeRecords().every(ownRecord)) changed = true;
      return changed;
    };
    new ResizeObserver(() => { pending(); changed = false; }).observe(probe);
    const tick = () => {
      probe.style.width = probe.style.width === '1px' ? '2px' : '1px';
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const read = (name: string) => {
      if (pending() && state.armed) state.forced.push(`${name} ${new Error().stack?.split('\n').slice(2, 7).join(' < ') ?? ''}`);
      changed = false;
    };
    for (const name of ['getBoundingClientRect', 'getClientRects'] as const) {
      const native = Element.prototype[name] as (this: Element) => unknown;
      (Element.prototype as unknown as Record<string, unknown>)[name] = function (this: Element) { read(name); return native.call(this); };
    }
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
    // The player UI lives in a shadow root; its changes count as well.
    const watchUi = () => {
      const root = document.getElementById('theater-everywhere-ui')?.shadowRoot;
      if (!root) { requestAnimationFrame(watchUi); return; }
      changes.observe(root, options);
    };
    watchUi();
  });
}

/**
 * The host shows or hides its Next control and resizes, as a page rebuild does, in one task. Returns
 * the recorded reads once the player's Next button follows and a few more frames have passed.
 */
async function hostChange(page: Page, shown: boolean): Promise<string[]> {
  await page.evaluate(next => {
    Object.assign((window as unknown as Restyle).__restyle, { armed: true, forced: [] });
    document.querySelector<HTMLElement>('.ytp-next-button')!.style.display = next ? '' : 'none';
    document.title = next ? 'Next video' : 'Navigation restyle';
    window.dispatchEvent(new Event('resize'));
  }, shown);
  await page.waitForFunction(next => {
    const button = document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector<HTMLElement>('.playlist-next-btn');
    return Boolean(button && !button.hidden) === next;
  }, shown, { polling: 'raf' });
  return page.evaluate(async () => {
    for (let frame = 0; frame < 6; frame++) await new Promise(resolve => requestAnimationFrame(resolve));
    const state = (window as unknown as Restyle).__restyle;
    state.armed = false;
    return state.forced;
  });
}

const browsers = sharedEngineBrowsers();

for (const engine of testEngines()) {
  it(`${engine}: player readers measure host changes without forcing a restyle`, { timeout: 60_000 }, async t => {
    const page = await (await browsers[engine].newContext(t, { viewport: { width: 1280, height: 720 } })).newPage();
    await serveFixture(page, FIXTURE, 'http://navigation-restyle.test/');
    await page.evaluate(() => {
      for (const name of ['ytp-prev-button', 'ytp-next-button']) {
        const button = document.createElement('button');
        button.className = name;
        button.textContent = name;
        button.style.display = 'none';
        document.body.append(button);
      }
    });
    // Before the player boots, so the probe's observer is delivered ahead of the player's.
    await page.addScriptTag({ content: 'window.__name = (fn) => fn;' });
    await instrument(page);
    await bootPlayer(page);
    await page.waitForFunction(() => Boolean(document.querySelector('video')?.readyState && document.querySelector('video')!.readyState >= 2));
    await page.mouse.move(640, 300);
    await enterTheater(page);

    for (const shown of [true, false, true]) {
      assert.deepEqual(await hostChange(page, shown), [], 'a player read forced a restyle of pending DOM changes');
    }

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
  });
}
