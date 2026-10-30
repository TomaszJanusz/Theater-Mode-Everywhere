import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BLOB_READ_TIMEOUT_MS, readCurrentBlobText } from './blob-text';
import { installVisitSignal } from './navigation-visit';

/**
 * A page window whose history moves `location.href`, as SPA hosts do. With `navigationApi`, every committed entry
 * change also fires `currententrychange`, as browsers do whichever method made it.
 */
function fakeWindow(navigationApi: boolean) {
  const handlers = new Map<string, () => void>();
  const location = { href: 'https://www.twitch.tv/videos/1' };
  const navigation = navigationApi ? new EventTarget() : undefined;
  const commit = (navigationType: string, url?: string | URL | null) => {
    if (url) location.href = new URL(String(url), location.href).href;
    navigation?.dispatchEvent(Object.assign(new Event('currententrychange'), { navigationType }));
  };
  const native = {
    pushState: (_state: unknown, _title: string, url?: string | URL | null) => commit('push', url),
    replaceState: (_state: unknown, _title: string, url?: string | URL | null) => commit('replace', url)
  };
  const history = { ...native } as unknown as History;
  const win = { location, history, navigation, addEventListener: (type: string, handler: () => void) => { handlers.set(type, handler); } };
  return { win: win as unknown as Window, history, native, commit, fire: (type: string) => handlers.get(type)?.() };
}

/** A stream the test feeds by hand; feeding it after the reader gave up must change nothing. */
function controlledBlob(size: number) {
  let control!: ReadableStreamDefaultController<Uint8Array>;
  let streams = 0;
  const blob = { size, stream: () => { streams += 1; return new ReadableStream<Uint8Array>({ start(c) { control = c; } }); } } as unknown as Blob;
  return {
    blob, streams: () => streams,
    push(text: string) { try { control.enqueue(new TextEncoder().encode(text)); } catch { /* cancelled */ } },
    close() { try { control.close(); } catch { /* cancelled */ } }
  };
}

/** Counts the abort listeners reads leave on the signals a visit hands out. */
function watched(visit: () => AbortSignal): { visit: () => AbortSignal; live: () => number } {
  const listeners = new Set<unknown>();
  const seen = new WeakSet<AbortSignal>();
  return { live: () => listeners.size, visit: () => {
    const signal = visit();
    if (seen.has(signal)) return signal;
    seen.add(signal);
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions) => {
      listeners.add(listener);
      add(type, listener, options);
    }) as AbortSignal['addEventListener'];
    signal.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.delete(listener);
      remove(type, listener);
    }) as AbortSignal['removeEventListener'];
    return signal;
  } };
}

const flush = () => new Promise<void>(resolve => { queueMicrotask(resolve); });

/** Starts a read on a hand-fed body, runs `during` while it is pending, then completes it. */
async function readAcross(visit: () => AbortSignal, during: () => void): Promise<string | null> {
  const body = controlledBlob(16);
  const pending = readCurrentBlobText(body.blob, 1024, visit);
  body.push('{"a":');
  await flush();
  during();
  body.push('1}');
  body.close();
  return pending;
}

for (const navigationApi of [true, false]) describe(`page visit ${navigationApi ? 'with' : 'without'} the Navigation API`, () => {
  it('ends on every new entry, including a return to the same URL, and keeps a state-only replace', () => {
    const { win, history, fire } = fakeWindow(navigationApi);
    const visit = installVisitSignal(win);
    const first = visit();
    history.replaceState({ scroll: 1 }, '');
    assert.equal(visit(), first, 'a state-only replace is not a navigation');
    history.pushState(null, '', '/videos/2');
    const second = visit();
    history.pushState(null, '', '/videos/1');
    assert.deepEqual([first.aborted, second.aborted, visit().aborted], [true, true, false], 'A→B→A is two navigations');
    for (const navigate of [() => history.pushState(null, '', '/videos/1'), () => history.replaceState(null, '', '/videos/3'),
      () => fire('popstate'), () => fire('hashchange'), () => fire('pagehide'), () => fire('pageshow')]) {
      const before = visit();
      navigate();
      assert.equal(visit() === before, false);
      assert.equal(before.aborted, true);
    }
  });

  it('keeps a read across a state-only replace', async () => {
    const { win, history } = fakeWindow(navigationApi);
    assert.equal(await readAcross(installVisitSignal(win), () => history.replaceState({ scroll: 2 }, '')), '{"a":1}');
  });

  it('drops a read when the host replaced both history methods and then went A→B→A', async () => {
    for (const replacement of ['native', 'foreign'] as const) {
      for (const when of ['before the read', 'during the read'] as const) {
        const { win, history, native, commit } = fakeWindow(navigationApi);
        const visit = installVisitSignal(win);
        const replace = () => {
          history.pushState = replacement === 'native' ? native.pushState : (_s, _t, url) => commit('push', url);
          history.replaceState = replacement === 'native' ? native.replaceState : (_s, _t, url) => commit('replace', url);
        };
        if (when === 'before the read') replace();
        const text = await readAcross(visit, () => {
          if (when === 'during the read') replace();
          history.pushState(null, '', '/videos/2');
          history.pushState(null, '', '/videos/1');
        });
        assert.equal(text, null, `${replacement} methods, replaced ${when}`);
      }
    }
  });
});

describe('page visit with the Navigation API', () => {
  it('ends on a navigation that bypasses history, such as an intercepted navigation.navigate()', async () => {
    const { win, commit } = fakeWindow(true);
    assert.equal(await readAcross(installVisitSignal(win), () => commit('push', '?intercepted=1')), null);
    const back = fakeWindow(true);
    const visit = installVisitSignal(back.win);
    assert.equal(await readAcross(visit, () => { back.commit('push', '?intercepted=1'); back.commit('traverse', '/videos/1'); }), null,
      'and its return to the same URL');
  });
});

describe('bounded Blob text', () => {
  it('reads a complete body once and leaves no listener on its visit', async () => {
    const { visit, live } = watched(installVisitSignal(fakeWindow(true).win));
    assert.equal(await readCurrentBlobText(new Blob(['{"data":1}']), 1024, visit), '{"data":1}');
    assert.equal(live(), 0);
  });

  it('drops a read across A→B→A, even when the body completes afterwards', async () => {
    const { win, history } = fakeWindow(false);
    const { visit, live } = watched(installVisitSignal(win));
    assert.equal(await readAcross(visit, () => {
      history.pushState(null, '', '/videos/2');
      history.pushState(null, '', '/videos/1');
    }), null);
    assert.equal(live(), 0);
  });

  it('drops a stalled read at its deadline and ignores a later completion', { timeout: 5000 }, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { visit, live } = watched(installVisitSignal(fakeWindow(true).win));
    const body = controlledBlob(16);
    let settled: string | null | undefined;
    const pending = readCurrentBlobText(body.blob, 1024, visit).then(text => { settled = text; return text; });
    await flush();
    t.mock.timers.tick(BLOB_READ_TIMEOUT_MS - 1);
    await flush();
    assert.equal(settled, undefined, 'still reading before the deadline');
    t.mock.timers.tick(1);
    assert.equal(await pending, null);
    body.push('{"late":true}');
    body.close();
    t.mock.timers.tick(60_000);
    await flush();
    assert.equal(settled, null);
    assert.equal(live(), 0);
  });

  it('keeps the text cap: an oversized Blob is never streamed, and a stream past the cap is dropped', async () => {
    const visit = installVisitSignal(fakeWindow(true).win);
    const oversized = controlledBlob(2048);
    assert.equal(await readCurrentBlobText(oversized.blob, 1024, visit), null);
    assert.equal(oversized.streams(), 0);
    const growing = controlledBlob(8);
    const pending = readCurrentBlobText(growing.blob, 8, visit);
    growing.push('0123456789');
    growing.close();
    assert.equal(await pending, null);
  });
});
