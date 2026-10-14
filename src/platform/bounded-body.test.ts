import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readBoundedBytes } from './bounded-body';

for (const length of [undefined, '0', '1', 'invalid', '-10']) {
  it(`bounds an endless stream with Content-Length ${length}`, async () => {
    let pulled = 0;
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pulled += 4; controller.enqueue(new Uint8Array(4)); },
      cancel() { cancelled++; }
    }, { highWaterMark: 0 });
    const headers = new Headers(length === undefined ? {} : { 'content-length': length });
    assert.equal(await readBoundedBytes({ body, headers }, 8), null);
    assert.equal(pulled, 12, 'stops at the first overflowing chunk');
    assert.equal(cancelled, 1);
    assert.equal(body.locked, false);
  });
}

it('rejects advertised oversize and pre-aborted reads without pulling', async () => {
  for (const aborted of [false, true]) {
    let pulled = 0;
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull() { pulled++; }, cancel() { cancelled++; }
    }, { highWaterMark: 0 });
    const controller = new AbortController();
    if (aborted) controller.abort();
    assert.equal(await readBoundedBytes({ body, headers: new Headers({ 'content-length': '100' }) }, 8, controller.signal), null);
    assert.equal(pulled, 0);
    assert.equal(cancelled, 1);
  }
});

it('drops a single giant chunk without waiting for cancellation', async () => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; return new Promise<void>(() => {}); }
  }, { highWaterMark: 0 });
  assert.equal(await readBoundedBytes({ body }, 8), null);
  assert.equal(pulls, 1);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

it('preserves UTF-8 and binary bytes exactly up to the cap', async () => {
  const bytes = new TextEncoder().encode('WEBVTT\nZażółć 🎭');
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    }
  });
  const result = await readBoundedBytes({ body, headers: new Headers({ 'content-length': '1' }) }, bytes.length);
  assert.deepEqual(new Uint8Array(result!), bytes);
  assert.equal(body.locked, false);
});

it('copies accepted views so reused or oversized backing buffers do not corrupt retained bytes', async () => {
  const backing = new Uint8Array(1024 * 1024);
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulls === 2) { controller.close(); return; }
      backing[0] = ++pulls;
      controller.enqueue(backing.subarray(0, 1));
    }
  }, { highWaterMark: 0 });
  assert.deepEqual(new Uint8Array((await readBoundedBytes({ body }, 2))!), Uint8Array.of(1, 2));
});

it('aborts a stalled read and releases the reader', async () => {
  const controller = new AbortController();
  let started!: () => void;
  const reading = new Promise<void>(resolve => { started = resolve; });
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull() { started(); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const result = readBoundedBytes({ body }, 8, controller.signal);
  await reading;
  controller.abort();
  assert.equal(await result, null);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

it('times out a stalled read even when the caller supplies a signal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const controller = new AbortController();
  const result = readBoundedBytes({ body }, 8, controller.signal, 100);
  t.mock.timers.tick(100);
  assert.equal(await result, null);
  assert.equal(cancelled, true);
  assert.equal(controller.signal.aborted, false, 'does not abort caller-owned work');
  assert.equal(body.locked, false);
});

it('rejects a stale session before accepting its next chunk', async () => {
  let current = true;
  let deliver!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(controller) { deliver = controller; }, cancel() { cancelled = true; } });
  const result = readBoundedBytes({ body }, 8, undefined, undefined, () => current);
  current = false;
  deliver.enqueue(Uint8Array.of(1));
  assert.equal(await result, null);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

it('fails closed on body errors and never falls back to a materializing read', async () => {
  const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error('network failure')); } });
  assert.equal(await readBoundedBytes({ body }, 8), null);
  assert.equal(body.locked, false);
  assert.equal(await readBoundedBytes({ body: null }, 8), null);
  assert.equal(await readBoundedBytes(new Response(null), 8), null);
});
