import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { contextMayCapture, createPlaybackReconciler, type PlaybackContext } from './media-audio-lifecycle';

/** A context whose resume/suspend complete only when the test settles them. */
class FakeContext implements PlaybackContext {
  state: AudioContextState;
  calls: Array<'resume' | 'suspend'> = [];
  private settlers: Array<{ ok(): void; fail(error: unknown): void }> = [];
  constructor(state: AudioContextState) { this.state = state; }
  resume() { return this.start('resume', 'running'); }
  suspend() { return this.start('suspend', 'suspended'); }
  private start(call: 'resume' | 'suspend', next: AudioContextState): Promise<void> {
    this.calls.push(call);
    return new Promise((resolve, reject) => {
      this.settlers.push({
        ok: () => { if (this.state !== 'closed') this.state = next; resolve(); },
        fail: reject
      });
    });
  }
  get inFlight() { return this.settlers.length; }
  /** Completes the oldest operation and lets its continuation run. */
  async settle(error?: unknown) {
    const settler = this.settlers.shift()!;
    if (error === undefined) settler.ok(); else settler.fail(error);
    await Promise.resolve();
    await Promise.resolve();
  }
}

function setup(state: AudioContextState, media: { playing: boolean; attached: boolean } = { playing: false, attached: true }) {
  const context = new FakeContext(state);
  const events = { detached: 0, errors: [] as unknown[] };
  const reconciler = createPlaybackReconciler({
    context,
    isPlaying: () => media.playing,
    isAttached: () => media.attached,
    onDetached: () => { events.detached++; },
    onError: error => { events.errors.push(error); }
  });
  return { context, media, events, reconciler };
}

describe('media audio playback lifecycle', () => {
  it('suspends a running context while media is paused, including after a browser auto-resume', async () => {
    const { context, reconciler } = setup('running');
    reconciler.reconcile();
    assert.deepEqual(context.calls, ['suspend']);
    await context.settle();
    // A gesture lets the browser resume the context on its own and fire statechange.
    context.state = 'running';
    reconciler.reconcile();
    assert.deepEqual(context.calls, ['suspend', 'suspend'], 'paused media never keeps a running context');
  });

  it('resumes while media plays and suspends again on pause, without redundant calls', async () => {
    const { context, media, reconciler } = setup('suspended');
    reconciler.reconcile();
    assert.deepEqual(context.calls, [], 'a paused, suspended context is left alone');
    media.playing = true;
    reconciler.reconcile();
    await context.settle();
    reconciler.reconcile();
    assert.deepEqual(context.calls, ['resume'], 'a running context under playing media needs no call');
    media.playing = false;
    reconciler.reconcile();
    await context.settle();
    assert.deepEqual(context.calls, ['resume', 'suspend']);
    assert.equal(context.state, 'suspended');
  });

  it('suspends after a resume that was still pending when the media paused', async () => {
    const { context, media, reconciler } = setup('suspended', { playing: true, attached: true });
    reconciler.reconcile();
    media.playing = false;
    reconciler.reconcile();
    reconciler.reconcile();
    assert.deepEqual(context.calls, ['resume'], 'only one operation is in flight');
    await context.settle();
    assert.deepEqual(context.calls, ['resume', 'suspend'], 'the pause that arrived meanwhile is reconciled');
    await context.settle();
    assert.equal(context.state, 'suspended');
    assert.equal(context.inFlight, 0);
  });

  it('resumes after a suspend that was still pending when playback restarted', async () => {
    const { context, media, reconciler } = setup('running');
    reconciler.reconcile();
    media.playing = true;
    reconciler.reconcile();
    await context.settle();
    assert.deepEqual(context.calls, ['suspend', 'resume']);
    await context.settle();
    assert.equal(context.state, 'running');
  });

  it('does no work after disposal, including when a pending resume completes late', async () => {
    const { context, media, reconciler } = setup('suspended', { playing: true, attached: true });
    reconciler.reconcile();
    media.playing = false;
    reconciler.dispose();
    await context.settle();
    assert.deepEqual(context.calls, ['resume'], 'a retired graph is not suspended again');
    reconciler.reconcile();
    assert.deepEqual(context.calls, ['resume']);
  });

  it('reports detached media once and leaves the context to its owner', () => {
    const { context, media, events, reconciler } = setup('running');
    media.attached = false;
    reconciler.reconcile();
    assert.equal(events.detached, 1);
    assert.deepEqual(context.calls, []);
    reconciler.dispose();
    reconciler.reconcile();
    assert.equal(events.detached, 1, 'a retired lifecycle stays quiet');
  });

  it('ignores a detach that happens while an operation is pending until it settles', async () => {
    const { context, media, events, reconciler } = setup('suspended', { playing: true, attached: true });
    reconciler.reconcile();
    media.attached = false;
    reconciler.reconcile();
    assert.equal(events.detached, 0);
    await context.settle();
    assert.equal(events.detached, 1, 'the settled operation notices the detach');
    assert.deepEqual(context.calls, ['resume']);
  });

  it('never touches a closed context', () => {
    for (const playing of [true, false]) {
      const { context, reconciler } = setup('closed', { playing, attached: true });
      reconciler.reconcile();
      assert.deepEqual(context.calls, []);
    }
  });

  it('reports a failed operation, stops, and allows the next event to retry', async () => {
    const { context, media, events, reconciler } = setup('suspended', { playing: true, attached: true });
    reconciler.reconcile();
    const failure = new Error('resume rejected');
    await context.settle(failure);
    assert.deepEqual(events.errors, [failure]);
    assert.deepEqual(context.calls, ['resume'], 'a failure does not loop');
    media.playing = true;
    reconciler.reconcile();
    assert.deepEqual(context.calls, ['resume', 'resume'], 'the failed operation no longer blocks reconciliation');
  });

  it('recovers on the next event when resume throws synchronously', () => {
    const { context, events, reconciler } = setup('suspended', { playing: true, attached: true });
    let throwing = true;
    const resume = context.resume.bind(context);
    context.resume = () => { if (throwing) throw new Error('patched context'); return resume(); };
    reconciler.reconcile();
    assert.equal(events.errors.length, 1);
    assert.equal(context.inFlight, 0);
    throwing = false;
    reconciler.reconcile();
    assert.deepEqual(context.calls, ['resume'], 'a synchronous throw does not leave the graph marked busy');
  });

  it('keeps a failure of a retired graph silent', async () => {
    const { context, events, reconciler } = setup('suspended', { playing: true, attached: true });
    reconciler.reconcile();
    reconciler.dispose();
    await context.settle(new Error('closed while resuming'));
    assert.deepEqual(events.errors, []);
  });

  it('leaves states it does not manage alone', () => {
    for (const state of ['interrupted'] as AudioContextState[]) {
      for (const playing of [true, false]) {
        const { context, reconciler } = setup(state, { playing, attached: true });
        reconciler.reconcile();
        assert.deepEqual(context.calls, []);
      }
    }
  });
});

describe('context capture admission', () => {
  const cases: Array<[string, Parameters<typeof contextMayCapture>[0], boolean]> = [
    ['a user gesture always admits the context', { activated: true, state: 'suspended', policy: 'disallowed' }, true],
    ['an autoplay-held context stays out of the media path', { activated: false, state: 'suspended', policy: undefined }, false],
    ['a policy that disallows autoplay keeps the context out', { activated: false, state: 'suspended', policy: 'disallowed' }, false],
    ['a browser that starts the context synchronously admits it', { activated: false, state: 'running', policy: undefined }, true],
    ['a reported policy allows a context that starts suspended', { activated: false, state: 'suspended', policy: 'allowed' }, true]
  ];
  for (const [name, input, expected] of cases) it(name, () => assert.equal(contextMayCapture(input), expected));
});
