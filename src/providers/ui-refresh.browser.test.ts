import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sharedEngineBrowsers } from '../test-utils/engine-browsers';
import { bundleModules } from '../test-utils/player-boot';
import { testEngines } from '../test-utils/test-engines';

const bundle = bundleModules([
  "export { observeProviderDom } from './providers/dom-watch';",
  "export { subscribePlaylistNavigation } from './providers/navigation/watch';",
  "export { CaptionRenderer } from './media-features/caption-renderer';",
  "export { mountServiceActionCta } from './ui/service-actions';",
  "export { observeChromeVisibility } from './ui/chrome-visibility';",
  "export { createNetflixServiceActions } from './providers/netflix/service-actions';",
  "export { DisposableScope } from './core/disposable-scope';"
], 'RefreshTest');
const browsers = sharedEngineBrowsers();
type Api = typeof import('./dom-watch') & typeof import('./navigation/watch')
  & typeof import('../media-features/caption-renderer') & typeof import('../ui/service-actions')
  & typeof import('../core/disposable-scope') & typeof import('./netflix/service-actions') & typeof import('../ui/chrome-visibility');

for (const engine of testEngines()) describe(`${engine} UI refresh ownership`, () => {
  it('coalesces scoped changes, stops hidden polling, rebinds shadow players and disposes in documents and iframes', async t => {
    const page = await (await browsers[engine].newContext(t)).newPage();
    await page.setContent('<iframe srcdoc="<body></body>"></iframe>');
    const child = page.frames().find(frame => frame !== page.mainFrame())!;
    for (const frame of [page.mainFrame(), child]) {
      await frame.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
      for (const shadow of [false, true]) {
        const report = await frame.evaluate(async shadow => {
          const api = (window as unknown as { RefreshTest: Api }).RefreshTest;
          const frames = new Map<number, FrameRequestCallback>();
          const timers = new Map<number, { run: () => void; at: number }>();
          let id = 0, now = 0, hidden = false, reads = 0;
          const oldRaf = window.requestAnimationFrame, oldCancel = window.cancelAnimationFrame;
          const oldTimeout = window.setTimeout, oldClear = window.clearTimeout;
          // Without a resize observer the shared read phase runs straight from the faked frame.
          const oldObserver = window.ResizeObserver;
          Object.assign(window, { ResizeObserver: undefined });
          window.requestAnimationFrame = callback => { frames.set(++id, callback); return id; };
          window.cancelAnimationFrame = key => { frames.delete(key); };
          window.setTimeout = ((run: () => void, ms: number) => { timers.set(++id, { run, at: now + ms }); return id; }) as typeof window.setTimeout;
          window.clearTimeout = key => { if (typeof key === 'number') timers.delete(key); };
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
          const flush = async () => {
            await Promise.resolve();
            const pending = [...frames.values()]; frames.clear();
            for (const callback of pending) callback(now);
            await Promise.resolve();
          };
          const advance = async (ms: number) => {
            now += ms;
            for (const [key, timer] of [...timers]) if (timer.at <= now) { timers.delete(key); timer.run(); }
            await flush();
          };
          const container = document.createElement('div'); document.body.append(container);
          const root = shadow ? container.attachShadow({ mode: 'open' }) : document;
          // A host-neutral surface: YouTube's playlist panel is observed only where YouTube registers.
          const panel = Object.assign(document.createElement('button'), { className: 'vjs-next-video' });
          (shadow ? root : container).appendChild(panel);
          const stop = api.subscribePlaylistNavigation(root, () => {
            reads++; return { previous: false, next: true, previousRestarts: false, previousPreview: null, nextPreview: null };
          }, () => {});
          const initial = reads;
          for (let i = 0; i < 20; i++) panel.append(document.createElement('span'));
          await flush(); const burst = reads - initial;
          const beforeUnrelated = reads;
          const outside = document.createElement('aside'); container.append(outside);
          outside.textContent = 'Unrelated host UI';
          const own = document.createElement('div'); own.id = 'theater-everywhere-ui'; panel.append(own);
          const ownRoot = own.attachShadow({ mode: 'open' }); ownRoot.append(document.createElement('div'));
          await flush();
          // Mounting and painting our shadow UI do not change host availability.
          const beforeOwn = reads;
          ownRoot.firstElementChild!.className = 'tick';
          outside.className = 'other'; outside.textContent = 'Unrelated mutation';
          await flush(); const ownUpdates = reads - beforeOwn;
          const beforeFallback = reads;
          await advance(999); const beforeSecond = reads - beforeFallback;
          await advance(1); const fallback = reads - beforeFallback;
          hidden = true; document.dispatchEvent(new Event('visibilitychange'));
          const hiddenTimers = timers.size;
          panel.append(document.createElement('span'));
          await advance(5000); const hiddenReads = reads - beforeFallback - fallback;
          hidden = false; document.dispatchEvent(new Event('visibilitychange'));
          const returnReads = reads - beforeFallback - fallback;
          const host = document.createElement('queue-control'); panel.append(host);
          await flush(); host.attachShadow({ mode: 'open' }).innerHTML = '<button>Next</button>';
          await advance(1000); const beforeShadow = reads;
          host.shadowRoot!.querySelector('button')!.disabled = true;
          await flush(); const shadowReads = reads - beforeShadow;
          const replacement = Object.assign(document.createElement('button'), { className: 'vjs-next-video' }); panel.replaceWith(replacement);
          await flush(); const beforeReplacement = reads;
          replacement.textContent = 'new video'; await flush(); const replacementReads = reads - beforeReplacement;
          stop(); stop(); const beforeDispose = reads;
          replacement.textContent = 'after disposal'; window.dispatchEvent(new PopStateEvent('popstate'));
          await advance(5000);
          const disposed = { reads: reads - beforeDispose, timers: timers.size, frames: frames.size };
          container.remove();
          window.requestAnimationFrame = oldRaf; window.cancelAnimationFrame = oldCancel;
          Object.assign(window, { ResizeObserver: oldObserver });
          window.setTimeout = oldTimeout; window.clearTimeout = oldClear;
          delete (document as unknown as { hidden?: boolean }).hidden;
          return { initial, burst, ownUpdates, beforeSecond, fallback, hiddenTimers, hiddenReads, returnReads,
            shadowReads, replacementReads, disposed, unrelatedMount: beforeOwn - beforeUnrelated };
        }, shadow);
        assert.equal(report.initial, 1);
        assert.equal(report.burst, 1);
        assert.equal(report.ownUpdates, 0);
        assert.equal(report.unrelatedMount, 0);
        assert.equal(report.beforeSecond, 0);
        assert.equal(report.fallback, 1);
        assert.equal(report.hiddenTimers, 0);
        assert.equal(report.hiddenReads, 0);
        assert.equal(report.returnReads, 1);
        assert.equal(report.shadowReads, 1);
        assert.equal(report.replacementReads, 1);
        assert.deepEqual(report.disposed, { reads: 0, timers: 0, frames: 0 });
      }
    }
  });

  it('owns exactly one action fallback and ignores video paint, disabling and hidden documents', async t => {
    const page = await (await browsers[engine].newContext(t)).newPage();
    await page.setContent('<div class="watch-video"><div data-uia="player" data-videoid="123"><video></video><button data-uia="player-skip-recap">Skip recap</button></div></div>');
    await page.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
    const report = await page.evaluate(async () => {
      const api = (window as unknown as { RefreshTest: Api }).RefreshTest;
      const frames = new Map<number, FrameRequestCallback>();
      const timers = new Map<number, { at: number; run: () => void }>();
      let serial = 0, now = 0, hidden = false, reads = 0;
      Object.assign(window, { ResizeObserver: undefined });
      window.requestAnimationFrame = cb => { frames.set(++serial, cb); return serial; };
      window.cancelAnimationFrame = id => { frames.delete(id); };
      window.setTimeout = ((run: () => void, ms: number) => { timers.set(++serial, { at: now + ms, run }); return serial; }) as typeof window.setTimeout;
      window.clearTimeout = id => { if (typeof id === 'number') timers.delete(id); };
      Object.defineProperty(document, 'hidden', { get: () => hidden });
      const flush = async () => {
        for (let i = 0; i < 3; i++) {
          await Promise.resolve();
          const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(now));
        }
      };
      const source = api.createNetflixServiceActions({ host: () => true, href: () => 'https://www.netflix.com/watch/123' });
      const read = source.read; source.read = () => { reads++; return read(); };
      const scope = new api.DisposableScope();
      api.mountServiceActionCta(scope, { source, mount: el => document.body.append(el), toolbarVisible: () => false,
        controlsLift: () => 96, subscribeToolbar: () => () => {} });
      await flush(); const initial = reads, activeTimers = timers.size;
      for (let i = 0; i < 100; i++) document.querySelector('video')!.style.width = `${i}px`;
      await flush(); const paintReads = reads - initial;
      now = 999; await flush(); const beforeSecond = reads - initial;
      now = 1000;
      for (const [key, timer] of [...timers]) if (timer.at <= now) { timers.delete(key); timer.run(); }
      await flush(); const fallbackReads = reads - initial;
      document.documentElement.setAttribute('data-te-netflix-integration-off', ''); await flush();
      const disabledTimers = timers.size;
      document.documentElement.removeAttribute('data-te-netflix-integration-off'); await flush();
      const enabledTimers = timers.size;
      hidden = true; document.dispatchEvent(new Event('visibilitychange'));
      const hiddenTimers = timers.size;
      scope.dispose(); await flush();
      return { initial, activeTimers, paintReads, beforeSecond, fallbackReads, disabledTimers, enabledTimers, hiddenTimers, disposedTimers: timers.size };
    });
    assert.equal(report.initial, 1); assert.equal(report.activeTimers, 1);
    assert.equal(report.paintReads, 0); assert.equal(report.beforeSecond, 0); assert.equal(report.fallbackReads, 1);
    assert.equal(report.disabledTimers, 0); assert.equal(report.enabledTimers, 1);
    assert.equal(report.hiddenTimers, 0); assert.equal(report.disposedTimers, 0);
  });

  it('writes only changed word states and invalidates timing for identical text in a new cue', async t => {
    const page = await (await browsers[engine].newContext(t)).newPage(); await page.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
    const report = await page.evaluate(() => {
      const api = (window as unknown as { RefreshTest: Api }).RefreshTest;
      const renderer = new api.CaptionRenderer();
      renderer.setCues([
        { start: 0, end: 2, text: 'Hello world', words: [{ start: 0, end: 1, text: 'Hello' }, { start: 1, end: 2, text: 'world' }] },
        { start: 2, end: 4, text: 'Hello world', words: [{ start: 2, end: 3, text: 'Hello' }, { start: 3, end: 4, text: 'world' }] }
      ]);
      renderer.update(0.5);
      const root = document.getElementById('theater-everywhere-ui')!.shadowRoot!;
      const text = root.querySelector('.theater-caption-overlay-text')!;
      const first = text.firstElementChild!;
      const observer = new MutationObserver(() => {}); observer.observe(text, { subtree: true, attributes: true, childList: true });
      for (let i = 0; i < 50; i++) renderer.update(0.5 + i / 1000);
      const stable = observer.takeRecords().length;
      renderer.update(1.1); const boundary = observer.takeRecords().length;
      renderer.update(2.1); const newCue = text.firstElementChild !== first;
      const classes = [...text.children].map(span => span.className);
      observer.takeRecords(); renderer.update(2.1); const repeat = observer.takeRecords().length;
      renderer.update(0.2); const seek = [...text.children].map(span => span.className);
      renderer.setMaxLines(3); renderer.update(0.2); const afterLineCap = text.firstElementChild !== first;
      renderer.dispose(); observer.disconnect();
      return { stable, boundary, newCue, classes, repeat, seek, afterLineCap, removed: !text.isConnected };
    });
    assert.equal(report.stable, 0); assert.equal(report.boundary, 2);
    assert.equal(report.newCue, true); assert.equal(report.repeat, 0);
    assert.deepEqual(report.classes, ['theater-caption-word is-current', 'theater-caption-word is-upcoming']);
    assert.deepEqual(report.seek, report.classes); assert.equal(report.removed, true); assert.equal(report.afterLineCap, true);
  });

  it('animates cached native progress without full reads or layout and stops for menus, hidden tabs and stale IDs', async t => {
    const page = await (await browsers[engine].newContext(t)).newPage(); await page.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
    const report = await page.evaluate(async () => {
      const api = (window as unknown as { RefreshTest: Api }).RefreshTest;
      const frames = new Map<number, FrameRequestCallback>(); let serial = 0;
      Object.assign(window, { ResizeObserver: undefined });
      window.requestAnimationFrame = cb => { frames.set(++serial, cb); return serial; };
      window.cancelAnimationFrame = id => { frames.delete(id); };
      let reads = 0, progressReads = 0, layouts = 0, placements = 0, menu = false, hidden = false;
      let value: number | null = 0.1, live = true;
      let changed = () => {};
      const menuFace = document.createElement('div'); menuFace.className = 'theater-cc-menu'; document.body.append(menuFace);
      Object.defineProperty(document, 'hidden', { get: () => hidden });
      const scope = new api.DisposableScope();
      api.mountServiceActionCta(scope, {
        source: { read: () => { reads++; return live ? [{ id: 'a', label: 'Next', progress: value ?? 0 }] : []; },
          readProgress: () => { progressReads++; return value; }, activate: () => true,
          subscribe: fn => { changed = fn; return () => { changed = () => {}; }; } },
        mount: el => document.body.append(el), toolbarVisible: () => true, controlsLift: () => { placements++; return 96; },
        subscribeToolbar: () => () => {}, subscribeVisibility: fn => api.observeChromeVisibility(document, fn),
        menuOpen: () => menu, onLayout: () => { layouts++; }
      });
      const advance = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(0)); };
      const initial = { reads, layouts, placements };
      for (let i = 0; i < 100; i++) { value = i / 200; advance(); }
      const animated = { reads, layouts, placements, progressReads };
      menu = true; menuFace.classList.add('visible'); await Promise.resolve(); const menuStopped = frames.size === 0;
      menu = false; value = 0.7; menuFace.classList.remove('visible'); await Promise.resolve();
      const resumed = document.querySelector<HTMLElement>('.theater-service-action-progress')!.style.transform;
      hidden = true; document.dispatchEvent(new Event('visibilitychange')); const hiddenStopped = frames.size === 0;
      hidden = false; value = 0.8; document.dispatchEvent(new Event('visibilitychange'));
      const visible = document.querySelector<HTMLElement>('.theater-service-action-progress')!.style.transform;
      const beforeEvents = reads; for (let i = 0; i < 30; i++) changed(); advance(); const eventReads = reads - beforeEvents;
      value = null; live = false; advance(); advance(); const expired = !document.querySelector('.theater-service-action');
      scope.dispose(); scope.dispose(); changed(); advance();
      return { initial, animated, menuStopped, resumed, hiddenStopped, visible, eventReads, expired,
        framesAfterDispose: frames.size, removed: !document.querySelector('.theater-service-action-host') };
    });
    assert.equal(report.animated.reads, report.initial.reads);
    assert.equal(report.animated.layouts, report.initial.layouts);
    assert.equal(report.animated.placements, report.initial.placements);
    assert.ok(report.animated.progressReads >= 100);
    assert.equal(report.menuStopped, true); assert.equal(report.hiddenStopped, true);
    assert.equal(report.resumed, 'scaleX(0.7)'); assert.equal(report.visible, 'scaleX(0.8)');
    assert.equal(report.eventReads, 1); assert.equal(report.expired, true);
    assert.equal(report.framesAfterDispose, 0); assert.equal(report.removed, true);
  });
});
