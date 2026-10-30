import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import { requestProviderProbe } from '../media-features/probe';
import { PROBE_ASYNC_EVENT, PROBE_ASYNC_REPLY_EVENT } from '../protocol/page-requests';
import type { ProviderHooks } from '../providers/provider-api';
import { createProviderRegistry } from '../providers/runtime-registration';

import { answerProviderProbes } from './provider-probe';

type Deferred = { promise: Promise<unknown>; resolve(value: unknown): void; reject(error: unknown): void };

function deferred(): Deferred {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

/** Lets promise reactions (MAIN's reply, the requester's resolution) run; timers are mocked and never fire by themselves. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** 'pending' when the probe has not settled without any timer firing, so a hang fails instead of waiting out the timeout. */
async function settled(probe: Promise<unknown>): Promise<unknown> {
  await flush();
  return Promise.race([probe, Promise.resolve('pending')]);
}

function replies(target: EventTarget): unknown[] {
  const seen: unknown[] = [];
  target.addEventListener(PROBE_ASYNC_REPLY_EVENT, event => seen.push((event as CustomEvent<unknown>).detail));
  return seen;
}

describe('asynchronous provider probe', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
  afterEach(() => mock.timers.reset());

  it('delivers a late MAIN result to the request that asked for it', async () => {
    const world = new EventTarget();
    const read = deferred();
    answerProviderProbes(world, id => id === 'bilibili' ? { probeAsync: () => read.promise } : undefined);
    const probe = requestProviderProbe('bilibili', 60_000, world);
    await flush();
    read.resolve({ videoId: 'BV1', tracks: [{ id: 'en' }] });
    assert.deepEqual(await settled(probe), { videoId: 'BV1', tracks: [{ id: 'en' }] });
  });

  it('drops a reply that arrives after a newer request for the provider', async () => {
    const world = new EventTarget();
    const sent = replies(world);
    const reads = [deferred(), deferred()];
    const signals: AbortSignal[] = [];
    answerProviderProbes(world, () => ({ probeAsync: (signal) => { signals.push(signal); return reads[signals.length - 1].promise; } }));
    const stale = requestProviderProbe('bilibili', 60_000, world);
    // The page moved on (episode change, rebinding): the adapter asks again before the first answer.
    const current = requestProviderProbe('bilibili', 60_000, world);
    assert.equal(await settled(stale), null);
    assert.deepEqual(signals.map(signal => signal.aborted), [true, false], 'the superseded read can stop its own requests');
    reads[0].resolve({ videoId: 'old' });
    await flush();
    assert.equal(sent.length, 0, 'MAIN must not answer the superseded request');
    reads[1].resolve({ videoId: 'new' });
    assert.deepEqual(await settled(current), { videoId: 'new' });
  });

  it('keeps providers independent', async () => {
    const world = new EventTarget();
    const reads: Record<string, Deferred> = { bilibili: deferred(), bilibiliIntl: deferred() };
    answerProviderProbes(world, id => ({ probeAsync: () => reads[id].promise }));
    const cn = requestProviderProbe('bilibili', 60_000, world);
    const intl = requestProviderProbe('bilibiliIntl', 60_000, world);
    reads.bilibiliIntl.resolve('intl');
    reads.bilibili.resolve('cn');
    assert.deepEqual([await settled(cn), await settled(intl)], ['cn', 'intl']);
  });

  it('leaves no listener behind once a request settles', async () => {
    const world = new EventTarget();
    let listeners = 0;
    const add = world.addEventListener.bind(world);
    const remove = world.removeEventListener.bind(world);
    world.addEventListener = (type, listener, options) => { if (type === PROBE_ASYNC_REPLY_EVENT) listeners++; add(type, listener, options); };
    world.removeEventListener = (type, listener, options) => { if (type === PROBE_ASYNC_REPLY_EVENT) listeners--; remove(type, listener, options); };
    const never = deferred();
    answerProviderProbes(world, id => ({ probeAsync: async () => id === 'tencent' ? never.promise : 'value' }));
    assert.equal(await settled(requestProviderProbe('bilibili', 60_000, world)), 'value');
    const timedOut = requestProviderProbe('tencent', 5, world);
    mock.timers.tick(5);
    assert.equal(await settled(timedOut), null);
    const superseded = requestProviderProbe('netflix', 60_000, world);
    const answered = requestProviderProbe('netflix', 60_000, world);
    assert.deepEqual([await settled(superseded), await settled(answered)], [null, 'value']);
    assert.equal(listeners, 0);
  });

  it('answers null promptly for a provider MAIN refused because it registered after startup', async () => {
    const world = new EventTarget();
    const registry = createProviderRegistry('www.iq.com');
    registry.start();
    const late = { id: 'iqiyi', contractVersion: 1, probeAsync: async () => ({ late: true }),
      watchPlayback: { pageIdentity: () => null, mainVideo: () => null } } satisfies ProviderHooks;
    assert.equal(registry.register(late), false);
    answerProviderProbes(world, id => registry.get(id));
    assert.equal(await settled(requestProviderProbe('iqiyi', 60_000, world)), null);
  });

  it('answers null for a rejected, throwing or unserializable probe', async () => {
    const world = new EventTarget();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const hooks: Record<string, Pick<ProviderHooks, 'probeAsync'>> = {
      rejects: { probeAsync: () => Promise.reject(new Error('host api')) },
      throws: { probeAsync: () => { throw new Error('host api'); } },
      circular: { probeAsync: async () => circular },
      huge: { probeAsync: async () => 'x'.repeat(2 * 1024 * 1024) }
    };
    answerProviderProbes(world, id => hooks[id]);
    for (const id of Object.keys(hooks)) assert.equal(await settled(requestProviderProbe(id, 60_000, world)), null, id);
  });

  it('resolves null on timeout, and its late reply does not answer the next request', async () => {
    const world = new EventTarget();
    const reads = [deferred(), deferred()];
    let call = 0;
    answerProviderProbes(world, () => ({ probeAsync: () => reads[call++].promise }));
    const first = requestProviderProbe('bilibili', 5, world);
    mock.timers.tick(5);
    assert.equal(await settled(first), null);
    const next = requestProviderProbe('bilibili', 60_000, world);
    reads[0].resolve({ late: true });
    await flush();
    assert.equal(await settled(next), 'pending');
    reads[1].resolve('fresh');
    assert.equal(await settled(next), 'fresh');
  });

  it('accepts only well-formed replies correlated with the pending request', async () => {
    const world = new EventTarget();
    let requestId = 0;
    world.addEventListener(PROBE_ASYNC_EVENT, event => {
      requestId = JSON.parse((event as CustomEvent<string>).detail).requestId;
    });
    const probe = requestProviderProbe('bilibili', 60_000, world);
    const forged = [
      { requestId, provider: 'bilibili', value: 'object detail' },
      JSON.stringify({ requestId: requestId + 1, value: 'other request' }),
      JSON.stringify({ requestId }),
      'not json'
    ];
    for (const detail of forged) world.dispatchEvent(new CustomEvent(PROBE_ASYNC_REPLY_EVENT, { detail }));
    assert.equal(await settled(probe), 'pending');
    world.dispatchEvent(new CustomEvent(PROBE_ASYNC_REPLY_EVENT, { detail: JSON.stringify({ requestId, value: 'ok' }) }));
    assert.equal(await settled(probe), 'ok');
  });

  it('ignores malformed requests in MAIN', async () => {
    const world = new EventTarget();
    const sent = replies(world);
    let reads = 0;
    answerProviderProbes(world, () => ({ probeAsync: async () => { reads++; return 'x'; } }));
    for (const detail of [{ requestId: 1, provider: 'bilibili' }, JSON.stringify({ requestId: 0, provider: 'bilibili' }),
      JSON.stringify({ requestId: 1, provider: 7 }), JSON.stringify({ requestId: 1 })]) {
      world.dispatchEvent(new CustomEvent(PROBE_ASYNC_EVENT, { detail }));
    }
    await flush();
    assert.equal(reads, 0);
    assert.equal(sent.length, 0);
  });
});
