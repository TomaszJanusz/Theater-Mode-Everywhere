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

type Restyle = { __restyle: { armed: boolean; forced: string[]; layouts: number; changes: MutationObserver } };

const OBSERVED = { subtree: true, childList: true, attributes: true, characterData: true };

/**
 * Records layout reads made while the DOM has changed since the browser last laid it out. A probe
 * whose width an animation changes in every frame marks each layout: its resize observer is created
 * before the player's, so it is delivered first, right after the frame's style and layout.
 */
function instrument(page: Page): Promise<void> {
  return page.evaluate(observed => {
    const changes = new MutationObserver(() => { changed = true; });
    const state = { armed: false, forced: [] as string[], layouts: 0, changes };
    (window as unknown as Restyle).__restyle = state;
    const style = document.createElement('style');
    style.textContent = '@keyframes navigation-restyle-probe { from { width: 1px } to { width: 101px } }';
    document.head.append(style);
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;height:1px;pointer-events:none;opacity:0;'
      + 'animation:navigation-restyle-probe 1s linear infinite alternate';
    document.documentElement.append(probe);
    let changed = false;
    changes.observe(document, observed);
    const pending = () => {
      if (changes.takeRecords().length) changed = true;
      return changed;
    };
    new ResizeObserver(() => { pending(); changed = false; state.layouts++; }).observe(probe);
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
  }, OBSERVED);
}

/** The player UI lives in a shadow root; its changes count as well. */
function observePlayerUi(page: Page): Promise<void> {
  return page.evaluate(observed => {
    (window as unknown as Restyle).__restyle.changes.observe(document.getElementById('theater-everywhere-ui')!.shadowRoot!, observed);
  }, OBSERVED);
}

/**
 * The host shows or hides its Next control, retitles and resizes, as a page rebuild does, in one
 * task. Returns the recorded reads once the player's Next button follows and six more frames have
 * been laid out.
 */
async function hostChange(page: Page, shown: boolean): Promise<string[]> {
  await page.evaluate(next => {
    Object.assign((window as unknown as Restyle).__restyle, { armed: true, forced: [] });
    document.querySelector<HTMLElement>('.vjs-next-video')!.style.display = next ? '' : 'none';
    document.title = next ? 'Next video' : 'Navigation restyle';
    window.dispatchEvent(new Event('resize'));
  }, shown);
  await page.waitForFunction(next => {
    const button = document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector<HTMLElement>('.playlist-next-btn');
    return Boolean(button && !button.hidden) === next;
  }, shown, { polling: 'raf' });
  const layouts = await page.evaluate(() => (window as unknown as Restyle).__restyle.layouts);
  await page.waitForFunction(count => (window as unknown as Restyle).__restyle.layouts >= count + 6, layouts, { polling: 'raf' });
  return page.evaluate(() => {
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
      // Video.js controls are read on any host; YouTube's own are read only in YouTube documents.
      for (const name of ['vjs-previous-video', 'vjs-next-video']) {
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
    await observePlayerUi(page);

    for (const shown of [true, false, true]) {
      assert.deepEqual(await hostChange(page, shown), [], 'a player read forced a restyle of pending DOM changes');
    }

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
  });
}
