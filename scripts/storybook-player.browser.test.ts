import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chromium, firefox, type Frame, type Page } from 'playwright';

import { openStory, waitForStory } from '../.storybook/browser-navigation';
import { environment, PLAYER_STORY } from '../.storybook/profiles';
import { serveStorybook } from '../.storybook/static-server';
import { sharedTestBrowser } from '../src/test-utils/test-browser';
import { testEngines } from '../src/test-utils/test-engines';

// The composed Player story: production player UI on local fixture media in a fixture document.
// Input is real (Playwright pointer and keyboard) and goes into that document. These tests do not
// establish host behavior, services, MAIN/isolated worlds or the installed extension.
const VOLUME_STORY = 'components-volume-control--open';
const FRAME = 'iframe[title="Fixture document"]';

type Channel = { emit(type: string, payload: unknown): void };
declare global {
  interface Window {
    __leaks?: { listeners: Map<string, number>; objectUrls: Set<string>; intervals: Set<number> };
    __STORYBOOK_ADDONS_CHANNEL__?: Channel;
  }
}

/** Counts live listeners on the story page's own globals, and object URLs and intervals it creates. */
function trackLeaks(): void {
  if (window !== window.top) return;
  const leaks = { listeners: new Map<string, number>(), objectUrls: new Set<string>(), intervals: new Set<number>() };
  window.__leaks = leaks;
  const registered = new WeakMap<EventTarget, Set<string>>();
  const name = (target: EventTarget) => target === window ? 'window' : target === document ? 'document' : target === document.body ? 'body' : target === document.documentElement ? 'html' : undefined;
  const key = (type: string, listener: unknown, options: unknown) => `${type}:${String(listener)}:${typeof options === 'boolean' ? options : (options as { capture?: boolean } | undefined)?.capture === true}`;
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    const owner = name(this);
    if (owner && listener) {
      const keys = registered.get(this) ?? new Set<string>();
      registered.set(this, keys);
      const id = key(type, listener, options);
      if (!keys.has(id)) { keys.add(id); leaks.listeners.set(`${owner}:${type}`, (leaks.listeners.get(`${owner}:${type}`) ?? 0) + 1); }
    }
    return add.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    const owner = name(this);
    const keys = registered.get(this);
    if (owner && listener && keys?.delete(key(type, listener, options))) leaks.listeners.set(`${owner}:${type}`, (leaks.listeners.get(`${owner}:${type}`) ?? 1) - 1);
    return remove.call(this, type, listener, options);
  };
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  URL.createObjectURL = (object: Blob | MediaSource) => { const url = create(object); leaks.objectUrls.add(url); return url; };
  URL.revokeObjectURL = (url: string) => { leaks.objectUrls.delete(url); revoke(url); };
  const setInterval_ = window.setInterval;
  const clearInterval_ = window.clearInterval;
  window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const id = setInterval_(handler, timeout, ...args);
    leaks.intervals.add(id);
    return id;
  }) as typeof window.setInterval;
  window.clearInterval = ((id?: number) => { if (id !== undefined) leaks.intervals.delete(id); clearInterval_(id); }) as typeof window.clearInterval;
}

function fixtureFrame(page: Page): Frame {
  const frame = page.frames().find(candidate => candidate.parentFrame() === page.mainFrame());
  assert.ok(frame, 'fixture document frame');
  return frame;
}

/** Control inside the player's shadow root, addressed the way a user would reach it. */
const control = (page: Page, selector: string) => page.frameLocator(FRAME).locator(selector);

const emit = (page: Page, type: string, payload: unknown) => page.evaluate(([name, value]) => window.__STORYBOOK_ADDONS_CHANNEL__!.emit(name as string, value), [type, payload] as const);

function activeControl(page: Page): Promise<string | null> {
  return fixtureFrame(page).evaluate(() => {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    // A control's own class is its last: `theater-control-btn cc-btn`.
    return active instanceof HTMLElement ? active.className.split(' ').pop() ?? null : null;
  });
}

const openPanels = (page: Page) => fixtureFrame(page).evaluate(() => {
  const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
  const open = (selector: string) => !(root.querySelector<HTMLElement>(selector)?.inert ?? true);
  return {
    volume: open('.theater-volume-panel'), speed: open('.theater-speed-panel'),
    settings: root.querySelector('.player-settings-btn')?.getAttribute('aria-expanded') === 'true',
    captions: root.querySelector('.cc-btn')?.getAttribute('aria-expanded') === 'true'
  };
});

for (const engine of testEngines()) {
  const browser = sharedTestBrowser({ chromium, firefox }[engine]);

  test(`Player UI: real pointer and keyboard open each menu, menus exclude each other and Escape restores focus (${engine})`, { timeout: 120000 }, async t => {
    const server = await serveStorybook();
    t.after(server.close);
    const context = await browser.newContext(t, { reducedMotion: 'reduce' });
    // tsx wraps named functions in __name(); callbacks serialized into the fixture frame need it defined.
    await context.addInitScript('window.__name = fn => fn;');
    const page = await context.newPage();
    const profile = { ...environment(), viewport: { width: 1280, height: 720 }, args: { scenario: 'watching' } };
    await openStory(page, server.url, PLAYER_STORY, profile);
    const none = { volume: false, speed: false, settings: false, captions: false };
    assert.deepEqual(await openPanels(page), none);

    // Hover opens the slider menus; moving to the next control retires the previous one.
    await control(page, '.volume-btn').hover();
    assert.deepEqual(await openPanels(page), { ...none, volume: true });
    await control(page, '.speed-btn').hover();
    assert.deepEqual(await openPanels(page), { ...none, speed: true });

    // Pointer click pins a menu; opening another closes it (exclusion), a second click closes it.
    await control(page, '.player-settings-btn').click();
    assert.deepEqual(await openPanels(page), { ...none, settings: true });
    await control(page, '.cc-btn').click();
    assert.deepEqual(await openPanels(page), { ...none, captions: true });
    await control(page, '.cc-btn').click();
    assert.deepEqual(await openPanels(page), none);

    // Keyboard: Enter opens and moves focus into the menu; Escape closes it and returns focus to its trigger,
    // and the player stays in theater (Escape did not exit).
    for (const [trigger, key] of [['.cc-btn', 'captions'], ['.player-settings-btn', 'settings']] as const) {
      await control(page, trigger).focus();
      await page.keyboard.press('Enter');
      assert.equal((await openPanels(page))[key], true, `${trigger} opens from the keyboard`);
      assert.notEqual(await activeControl(page), trigger.slice(1), `${trigger}: focus moves into the menu`);
      await page.keyboard.press('Escape');
      assert.deepEqual(await openPanels(page), none);
      assert.equal(await activeControl(page), trigger.slice(1), `${trigger}: Escape restores focus`);
      assert.equal(await control(page, '.theater-controls-wrapper.visible').count(), 1, 'Escape closed the menu, not the player');
    }

    // Tab walks the enabled bar controls in document order.
    const order = await fixtureFrame(page).evaluate(() => {
      const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
      return [...root.querySelectorAll<HTMLElement>('.theater-controls-wrapper :is(button, [tabindex="0"]):not([disabled])')]
        .filter(element => !element.closest('[inert], [hidden]') && element.getClientRects().length > 0)
        .map(element => element.className.split(' ').pop()!);
    });
    assert.ok(order.length >= 6, `bar controls: ${order.join(', ')}`);
    await control(page, `.${order[0]}`).focus();
    // A slider panel is inert until its button has focus, so it joins the walk right after its button.
    const walked = [order[0]];
    for (let step = 1; step < order.length + 2; step++) {
      await page.keyboard.press('Tab');
      walked.push((await activeControl(page))!);
    }
    assert.deepEqual(walked.filter(name => name !== 'theater-vertical-slider').slice(0, order.length), order);
    assert.equal(walked.filter(name => name === 'theater-vertical-slider').length, 2, 'volume and speed sliders');
  });

  test(`Player UI: a locale change rebuilds the chrome and keeps the media element and time (${engine})`, { timeout: 120000 }, async t => {
    const server = await serveStorybook();
    t.after(server.close);
    const context = await browser.newContext(t, { reducedMotion: 'reduce' });
    const page = await context.newPage();
    await openStory(page, server.url, PLAYER_STORY, { ...environment(), args: { scenario: 'watching' } });
    const frame = fixtureFrame(page);
    await frame.evaluate(() => { document.querySelector('video')!.dataset.probe = 'same-element'; });
    const before = await frame.evaluate(() => ({ time: document.querySelector('video')!.currentTime, paused: document.querySelector('video')!.paused }));
    await page.evaluate(() => { (document.querySelector('iframe') as HTMLIFrameElement).dataset.probe = 'same-frame'; });
    await emit(page, 'updateGlobals', { globals: { locale: 'de' } });
    await page.waitForFunction(() => window.__storyState?.globals.locale === 'de');
    await waitForStory(page);
    await page.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.getElementById('theater-everywhere-ui')?.lang === 'de');
    const after = await fixtureFrame(page).evaluate(() => {
      const video = document.querySelector('video')!;
      const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
      return { probe: video.dataset.probe, time: video.currentTime, paused: video.paused,
        mute: root.querySelector('.volume-btn')?.getAttribute('aria-label'), lang: document.getElementById('theater-everywhere-ui')!.lang };
    });
    assert.deepEqual({ probe: after.probe, time: after.time, paused: after.paused, lang: after.lang }, { probe: 'same-element', time: before.time, paused: before.paused, lang: 'de' });
    assert.equal(after.mute, 'Stummschaltung umschalten');
    assert.equal(await page.evaluate(() => document.querySelector('iframe')?.dataset.probe), 'same-frame');
  });

  test(`Player UI: remount and navigation leave no document, listener, interval or object URL behind (${engine})`, { timeout: 120000 }, async t => {
    const server = await serveStorybook();
    t.after(server.close);
    const context = await browser.newContext(t, { reducedMotion: 'reduce' });
    await context.addInitScript(trackLeaks);
    const page = await context.newPage();
    const snapshot = () => page.evaluate(() => ({
      listeners: Object.fromEntries([...window.__leaks!.listeners].filter(([, count]) => count !== 0).sort()),
      objectUrls: window.__leaks!.objectUrls.size, intervals: window.__leaks!.intervals.size,
      frames: document.querySelectorAll('iframe').length
    }));
    await openStory(page, server.url, VOLUME_STORY, environment());
    const baseline = await snapshot();

    await emit(page, 'setCurrentStory', { storyId: PLAYER_STORY });
    await page.waitForFunction(id => (window as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { id?: string; phase?: string } } }).__STORYBOOK_PREVIEW__?.currentRender?.id === id
      && (window as unknown as { __STORYBOOK_PREVIEW__: { currentRender: { phase: string } } }).__STORYBOOK_PREVIEW__.currentRender.phase === 'finished', PLAYER_STORY);
    const first = await page.evaluateHandle(() => document.querySelector('iframe')!);
    const stub = await page.evaluateHandle(() => window.__playerFixture!.chromeStub);
    assert.ok(await stub.evaluate(listeners => listeners.listenerCount, undefined) >= 1, 'the runtime registered storage listeners at the extension edge');

    // Remount: a new document replaces the old one, which is gone.
    await emit(page, 'forceRemount', { storyId: PLAYER_STORY });
    await page.waitForFunction(old => !old.isConnected, first);
    await waitForStory(page);
    assert.equal(await first.evaluate(frame => frame.contentWindow), null);
    assert.equal(await stub.evaluate(edge => edge.listenerCount), 0, 'remount clears the old extension-edge listeners');
    assert.equal((await snapshot()).frames, 1);

    // Another story: nothing of the player remains.
    const second = await page.evaluateHandle(() => document.querySelector('iframe')!);
    await emit(page, 'setCurrentStory', { storyId: VOLUME_STORY });
    await page.waitForFunction(id => (window as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { id?: string; phase?: string } } }).__STORYBOOK_PREVIEW__?.currentRender?.id === id
      && (window as unknown as { __STORYBOOK_PREVIEW__: { currentRender: { phase: string } } }).__STORYBOOK_PREVIEW__.currentRender.phase === 'finished', VOLUME_STORY);
    assert.equal(await second.evaluate(frame => frame.isConnected), false);
    assert.equal(await page.evaluate(() => window.__playerFixture === undefined && window.__storyDocument === undefined), true);
    assert.deepEqual(await snapshot(), baseline);
  });
}
