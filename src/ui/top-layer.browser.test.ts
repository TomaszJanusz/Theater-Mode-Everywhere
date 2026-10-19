import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';

import * as playwright from 'playwright';
import type { Page } from 'playwright';

import { bootPlayer, enterTheater } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines, type TestEngine } from '../test-utils/test-engines';
import { canvasVideoFixture, serveFixture } from '../test-utils/video-fixtures';

const FIXTURE = canvasVideoFixture({ title: 'Top layer' })
  + '<div id="cover" style="position:fixed;inset:0;z-index:2147483647;background:#f00"></div>'
  + '<div id="late" popover="manual" style="position:fixed;inset:0;margin:0;width:auto;height:auto;border:0;background:#0f0"></div>'
  + '<dialog id="modal" style="position:fixed;inset:0;margin:0;width:auto;height:auto;max-width:none;max-height:none;border:0;background:#00f"></dialog>';

const HOST = '#theater-everywhere-ui';
const isOpen = (page: Page) => page.evaluate(h => document.querySelector(h)?.matches(':popover-open') ?? null, HOST);
/** True when the player UI, not the page, receives a hit at the middle of the control bar. */
const uiOnTop = (page: Page) => page.waitForFunction(h => {
  const host = document.querySelector(h)!;
  const r = host.shadowRoot!.querySelector('.theater-controls-wrapper')!.getBoundingClientRect();
  return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === host;
}, HOST, { timeout: 2000 }).then(() => true, () => false);

const shared = Object.fromEntries(testEngines().map(engine => [engine, sharedTestBrowser(playwright[engine])]));

async function open(t: TestContext, engine: TestEngine) {
  const page = await (await shared[engine].newContext(t, { viewport: { width: 1000, height: 700 } })).newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  // Net count of page-level toggle listeners (only the top-layer binding adds them), to prove cleanup.
  await page.addInitScript(() => {
    const ids = new WeakMap<object, number>();
    let nextId = 0;
    const live = new Set<string>();
    (window as any).liveListeners = () => live.size;
    for (const [method, add] of [['addEventListener', true], ['removeEventListener', false]] as const) {
      const original = EventTarget.prototype[method];
      EventTarget.prototype[method] = function (this: EventTarget, type: string, listener: any, options?: any) {
        if (this === document && type === 'toggle' && listener) {
          if (!ids.has(listener)) ids.set(listener, ++nextId);
          const key = `${type}:${(options === true || options?.capture) ? 'c' : 'b'}:${ids.get(listener)}`;
          add ? live.add(key) : live.delete(key);
        }
        return original.call(this, type, listener, options);
      } as typeof original;
    }
  });
  await serveFixture(page, FIXTURE, 'http://top-layer.test/');
  await page.addStyleTag({ content: '#cover, #late:not(:popover-open), #modal:not([open]) { display: none }' });
  return { page, errors };
}

for (const engine of testEngines()) {
  it(`${engine}: the host is an open popover while in theater and is gone after exit`, { timeout: 60_000 }, async t => {
    const { page, errors } = await open(t, engine);
    // The runtime ignores a second toggle for 200 ms; the fake clock passes that time deterministically.
    await page.clock.install();
    await bootPlayer(page);
    await page.clock.resume();
    let settled = -1;
    for (let i = 0; i < 3; i++) {
      assert.equal(await isOpen(page), null);
      await enterTheater(page);
      assert.equal(await isOpen(page), true);
      await page.keyboard.press('Escape');
      await page.locator(HOST).waitFor({ state: 'detached' });
      await page.clock.runFor(250);
      // Whatever the first cycle leaves registered, later cycles must not add to it.
      const live = await page.evaluate('window.liveListeners()') as number;
      if (settled < 0) settled = live;
      assert.equal(live, settled, `page-level toggle listeners after cycle ${i + 1}`);
    }
    assert.deepEqual(errors, []);
  });

  it(`${engine}: the UI is above page z-index, a popover shown before and one shown after`, { timeout: 60_000 }, async t => {
    const { page } = await open(t, engine);
    await bootPlayer(page);
    // Page content that wins with z-index alone, plus a popover that entered the top layer first.
    await page.evaluate(() => {
      document.getElementById('cover')!.style.display = 'block';
      (document.getElementById('late') as HTMLElement).showPopover();
    });
    await enterTheater(page);
    assert.equal(await uiOnTop(page), true, 'above z-index 2147483647 and an earlier popover');

    // A popover that opens later is raised over by the host again on the next frame.
    await page.evaluate(() => { const p = document.getElementById('late')!; p.hidePopover(); p.showPopover(); });
    await page.waitForFunction(() => document.querySelector('#theater-everywhere-ui')!.matches(':popover-open'));
    assert.equal(await uiOnTop(page), true, 'above a popover shown after entering theater');
    await page.keyboard.press('Escape');
    await page.locator(HOST).waitFor({ state: 'detached' });
  });

  it(`${engine}: a modal dialog opened after entering theater still covers the UI`, { timeout: 60_000 }, async t => {
    const { page } = await open(t, engine);
    await bootPlayer(page);
    await enterTheater(page);
    await page.evaluate(() => (document.getElementById('modal') as HTMLDialogElement).showModal());
    // Known limit (docs/top-layer.md): a modal dialog shown after the host covers it. Z-index never
    // beat a modal dialog either, so this is unchanged; the test pins it so an improvement is noticed.
    assert.equal(await uiOnTop(page), false);
    assert.equal(await isOpen(page), true);
  });

  it(`${engine}: document fullscreen enter and exit keep the UI shown and on top`, { timeout: 60_000 }, async t => {
    const { page, errors } = await open(t, engine);
    await bootPlayer(page);
    await enterTheater(page);
    const entered = await page.evaluate(() => document.documentElement.requestFullscreen().then(() => true, () => false));
    if (!entered) {
      t.diagnostic(`${engine} headless refused requestFullscreen; fullscreen re-show not asserted`);
      return;
    }
    await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
    assert.equal(await isOpen(page), true);
    assert.equal(await uiOnTop(page), true, 'above the fullscreen element');
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction(() => !document.fullscreenElement);
    assert.equal(await isOpen(page), true);
    assert.equal(await uiOnTop(page), true);
    assert.deepEqual(errors, []);
  });

  it(`${engine}: hiding the host from outside shows it again`, { timeout: 60_000 }, async t => {
    const { page } = await open(t, engine);
    await bootPlayer(page);
    await enterTheater(page);
    await page.evaluate(h => document.querySelector<HTMLElement>(h)!.hidePopover(), HOST);
    await page.waitForFunction(h => document.querySelector(h)!.matches(':popover-open'), HOST);
  });

  it(`${engine}: native chat keeps the host out of the top layer so service popups stay above it`, { timeout: 60_000 }, async t => {
    const { page } = await open(t, engine);
    await bootPlayer(page);
    await enterTheater(page);
    await page.evaluate(() => document.documentElement.setAttribute('data-theater-chat-active', ''));
    await page.waitForFunction(h => !document.querySelector(h)!.matches(':popover-open'), HOST);
    await page.evaluate(() => document.documentElement.removeAttribute('data-theater-chat-active'));
    await page.waitForFunction(h => document.querySelector(h)!.matches(':popover-open'), HOST);
  });
}
