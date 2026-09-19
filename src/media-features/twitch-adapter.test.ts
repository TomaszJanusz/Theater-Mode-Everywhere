import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TWITCH_CAPTIONS_ACK_EVENT, TWITCH_CAPTIONS_EVENT } from './parsers/twitch-page';
import { requestTwitchHostCaptions } from './twitch-adapter';

class TestCustomEvent<T> extends Event {
  detail: T;

  constructor(type: string, init: { detail: T }) {
    super(type);
    this.detail = init.detail;
  }
}

class TestWindow extends EventTarget {
  setTimeout(handler: TimerHandler, timeout?: number): number {
    return globalThis.setTimeout(handler, timeout) as unknown as number;
  }

  clearTimeout(id?: number): void {
    globalThis.clearTimeout(id);
  }
}

describe('Twitch host caption acknowledgement', () => {
  const OriginalCustomEvent = globalThis.CustomEvent;

  it('accepts only a matching successful acknowledgement', async () => {
    globalThis.CustomEvent = TestCustomEvent as unknown as typeof CustomEvent;
    const target = new TestWindow();
    target.addEventListener(TWITCH_CAPTIONS_EVENT, ((event: Event) => {
      const detail = (event as CustomEvent<{ requestId: string; enabled: boolean }>).detail;
      target.dispatchEvent(new CustomEvent(TWITCH_CAPTIONS_ACK_EVENT, {
        detail: { ...detail, applied: true }
      }));
    }) as EventListener);
    try {
      assert.equal(await requestTwitchHostCaptions(true, target as unknown as Window, 20), true);
    } finally {
      globalThis.CustomEvent = OriginalCustomEvent;
    }
  });

  it('fails when MAIN reports that no setter or button was available', async () => {
    globalThis.CustomEvent = TestCustomEvent as unknown as typeof CustomEvent;
    const target = new TestWindow();
    target.addEventListener(TWITCH_CAPTIONS_EVENT, ((event: Event) => {
      const detail = (event as CustomEvent<{ requestId: string; enabled: boolean }>).detail;
      target.dispatchEvent(new CustomEvent(TWITCH_CAPTIONS_ACK_EVENT, {
        detail: { ...detail, applied: false }
      }));
    }) as EventListener);
    try {
      assert.equal(await requestTwitchHostCaptions(true, target as unknown as Window, 20), false);
    } finally {
      globalThis.CustomEvent = OriginalCustomEvent;
    }
  });

  it('times out without a listener and ignores a late acknowledgement', async () => {
    globalThis.CustomEvent = TestCustomEvent as unknown as typeof CustomEvent;
    const target = new TestWindow();
    let requestId = '';
    target.addEventListener(TWITCH_CAPTIONS_EVENT, ((event: Event) => {
      requestId = (event as CustomEvent<{ requestId: string }>).detail.requestId;
    }) as EventListener);
    try {
      assert.equal(await requestTwitchHostCaptions(true, target as unknown as Window, 5), false);
      target.dispatchEvent(new CustomEvent(TWITCH_CAPTIONS_ACK_EVENT, {
        detail: { requestId, enabled: true, applied: true }
      }));
    } finally {
      globalThis.CustomEvent = OriginalCustomEvent;
    }
  });
});
