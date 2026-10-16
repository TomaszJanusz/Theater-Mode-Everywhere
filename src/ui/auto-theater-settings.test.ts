import assert from 'node:assert/strict';
import { it } from 'node:test';
import { shouldOfferVideoActivator, VIDEO_ACTIVATOR_PROMPT_ANSWER_STORAGE_KEY as ANSWER } from './video-activator-settings';

it('offers the launcher only while off and without a remembered boolean answer', () => {
  for (const videoActivator of [undefined, null, false, 'true', 1]) {
    for (const answer of [undefined, null, 'false', 0, {}]) {
      assert.equal(shouldOfferVideoActivator({ videoActivator, [ANSWER]: answer }), true);
    }
    for (const answer of [true, false]) {
      assert.equal(shouldOfferVideoActivator({ videoActivator, [ANSWER]: answer }), false);
    }
  }
  assert.equal(shouldOfferVideoActivator({ videoActivator: true }), false);
});

it('saves without a dialog for opt-in, repeated off, an enabled launcher or either remembered answer', async () => {
  const { saveAutoTheaterEnabled } = await import('./auto-theater-settings');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  try {
    for (const [enabled, settings] of [
      [true, {}], [false, {}], [false, { autoEnterTheater: false }],
      [false, { autoEnterTheater: true, videoActivator: true }],
      [false, { autoEnterTheater: true, [ANSWER]: false }],
      [false, { autoEnterTheater: true, [ANSWER]: true }]
    ] as const) {
      const saved: Record<string, unknown> = { ...settings };
      const writes: object[] = [];
      Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { storage: {
        sync: { get: async () => ({ ...saved }), set: async (values: object) => { writes.push(values); Object.assign(saved, values); } },
        onChanged: { addListener() { assert.fail('no dialog listener should be registered'); } }
      } } });
      await saveAutoTheaterEnabled(enabled);
      assert.deepEqual(writes, [{ autoEnterTheater: enabled }]);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'chrome', original);
    else Reflect.deleteProperty(globalThis, 'chrome');
  }
});

it('a delayed older read cannot overwrite a newer AutoTheater choice', async () => {
  const { saveAutoTheaterEnabled } = await import('./auto-theater-settings');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  let finishRead!: (value: object) => void;
  const delayedRead = new Promise<object>(resolve => { finishRead = resolve; });
  let reads = 0;
  const writes: object[] = [];
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { storage: { sync: {
    get: () => ++reads === 1 ? delayedRead : Promise.resolve({ autoEnterTheater: true }),
    set: async (values: object) => { writes.push(values); }
  } } } });
  try {
    const older = saveAutoTheaterEnabled(false);
    await saveAutoTheaterEnabled(true);
    finishRead({ autoEnterTheater: true });
    await older;
    assert.deepEqual(writes, [{ autoEnterTheater: true }]);
  } finally {
    if (original) Object.defineProperty(globalThis, 'chrome', original);
    else Reflect.deleteProperty(globalThis, 'chrome');
  }
});

it('serializes overlapping writes so the newest AutoTheater choice lands last', async () => {
  const { saveAutoTheaterEnabled } = await import('./auto-theater-settings');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  let finishOlderWrite!: () => void;
  let markOlderStarted!: () => void;
  let markNewerRead!: () => void;
  const olderStarted = new Promise<void>(resolve => { markOlderStarted = resolve; });
  const newerRead = new Promise<void>(resolve => { markNewerRead = resolve; });
  const delayedWrite = new Promise<void>(resolve => { finishOlderWrite = resolve; });
  const saved = { autoEnterTheater: true, videoActivator: true };
  const writes: object[] = [];
  let reads = 0;
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { storage: { sync: {
    get: async () => {
      if (++reads === 2) markNewerRead();
      return { ...saved };
    },
    set: async (values: object) => {
      writes.push(values);
      if (writes.length === 1) {
        markOlderStarted();
        await delayedWrite;
      }
      Object.assign(saved, values);
    }
  } } } });
  try {
    const older = saveAutoTheaterEnabled(false);
    await olderStarted;
    const newer = saveAutoTheaterEnabled(true);
    await newerRead;
    // Allow the newer read continuation to reach the pending write queue.
    await Promise.resolve();
    assert.deepEqual(writes, [{ autoEnterTheater: false }]);
    finishOlderWrite();
    await Promise.all([older, newer]);
    assert.deepEqual(writes, [{ autoEnterTheater: false }, { autoEnterTheater: true }]);
    assert.equal(saved.autoEnterTheater, true);
  } finally {
    finishOlderWrite();
    if (original) Object.defineProperty(globalThis, 'chrome', original);
    else Reflect.deleteProperty(globalThis, 'chrome');
  }
});

it('propagates a write error to its caller without blocking later writes', async () => {
  const { saveAutoTheaterEnabled } = await import('./auto-theater-settings');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  const failure = new Error('storage write failed');
  const saved = { autoEnterTheater: false };
  let writes = 0;
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { storage: { sync: {
    get: async () => ({ ...saved }),
    set: async (values: object) => {
      if (++writes === 1) throw failure;
      Object.assign(saved, values);
    }
  } } } });
  try {
    await assert.rejects(saveAutoTheaterEnabled(true), error => error === failure);
    await saveAutoTheaterEnabled(true);
    assert.equal(writes, 2);
    assert.equal(saved.autoEnterTheater, true);
  } finally {
    if (original) Object.defineProperty(globalThis, 'chrome', original);
    else Reflect.deleteProperty(globalThis, 'chrome');
  }
});
