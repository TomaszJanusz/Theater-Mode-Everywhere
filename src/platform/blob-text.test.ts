import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { BLOB_READ_TIMEOUT_MS, readCurrentBlobText } from './blob-text';
import { installVisitSignal } from './navigation-visit';

/** A page window whose history moves `location.href`, as SPA hosts do. */
function fakeWindow() {
  const handlers = new Map<string, () => void>();
  const location = { href: 'https://www.twitch.tv/videos/1' };
  const move = (_state: unknown, _title: string, url?: string | URL | null) => { if (url) location.href = new URL(String(url), location.href).href; };
  const history = { pushState: move, replaceState: move } as unknown as History;
  const win = { location, history, addEventListener: (type: string, handler: () => void) => { handlers.set(type, handler); } };
  return { win: win as unknown as Window, history, fire: (type: string) => handlers.get(type)?.() };
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

/** Counts the abort listeners a read leaves on its visit signal. */
function watched(signal: AbortSignal): { signal: AbortSignal; live: () => number } {
  const listeners = new Set<unknown>();
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
  return { signal, live: () => listeners.size };
}

const flush = () => new Promise<void>(resolve => { queueMicrotask(resolve); });

describe('page visit signal', () => {
  it('ends the visit on every new history entry, including a return to the same URL', () => {
    const { win, history, fire } = fakeWindow();
    const visit = installVisitSignal(win);
    const first = visit();
    history.replaceState({ scroll: 1 }, '');
    assert.equal(first.aborted, false, 'a state-only replace is not a navigation');
    history.pushState(null, '', '/videos/2');
    const second = visit();
    history.pushState(null, '', '/videos/1');
    assert.deepEqual([first.aborted, second.aborted, visit().aborted], [true, true, false], 'A→B→A is two navigations');
    for (const navigate of [() => history.pushState(null, '', '/videos/1'), () => history.replaceState(null, '', '/videos/3'),
      () => fire('popstate'), () => fire('hashchange'), () => fire('pagehide')]) {
      const before = visit();
      navigate();
      assert.equal(before.aborted, true);
      assert.notEqual(visit(), before);
    }
  });
});

describe('bounded Blob text', () => {
  it('reads a complete body once and leaves no listener on its visit', async () => {
    const { signal, live } = watched(new AbortController().signal);
    assert.equal(await readCurrentBlobText(new Blob(['{"data":1}']), 1024, signal), '{"data":1}');
    assert.equal(live(), 0);
  });

  it('drops a read across A→B→A, even when the body completes afterwards', async () => {
    const { win, history } = fakeWindow();
    const visit = installVisitSignal(win);
    const { signal, live } = watched(visit());
    const body = controlledBlob(16);
    const pending = readCurrentBlobText(body.blob, 1024, signal);
    body.push('{"old":');
    await flush();
    history.pushState(null, '', '/videos/2');
    history.pushState(null, '', '/videos/1');
    body.push('true}');
    body.close();
    assert.equal(await pending, null);
    assert.equal(live(), 0);
  });

  it('drops a stalled read at its deadline and ignores a later completion', { timeout: 5000 }, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { signal, live } = watched(new AbortController().signal);
    const body = controlledBlob(16);
    let settled: string | null | undefined;
    const pending = readCurrentBlobText(body.blob, 1024, signal).then(text => { settled = text; return text; });
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
    const signal = new AbortController().signal;
    const oversized = controlledBlob(2048);
    assert.equal(await readCurrentBlobText(oversized.blob, 1024, signal), null);
    assert.equal(oversized.streams(), 0);
    const growing = controlledBlob(8);
    const pending = readCurrentBlobText(growing.blob, 8, signal);
    growing.push('0123456789');
    growing.close();
    assert.equal(await pending, null);
  });

  it('starts no read in a visit that has already ended', async () => {
    const ended = new AbortController();
    ended.abort();
    const body = controlledBlob(4);
    assert.equal(await readCurrentBlobText(body.blob, 1024, ended.signal), null);
  });
});
