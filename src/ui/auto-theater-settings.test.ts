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
