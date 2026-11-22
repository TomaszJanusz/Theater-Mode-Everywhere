import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { watchAuthorBylineSetting } from './author-byline-setting';
import { BYLINE_STORAGE_KEY, resolveBylineEnabled } from './settings-values';

type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;

/** A sync area whose first read resolves only when the test says so. */
function installStorage(stored: Record<string, unknown>) {
  const listeners = new Set<Listener>();
  let release!: () => void;
  const read = new Promise<void>(resolve => { release = resolve; });
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      sync: { get: async (key: string) => { await read; return { [key]: stored[key] }; } },
      onChanged: { addListener: (listener: Listener) => listeners.add(listener), removeListener: (listener: Listener) => listeners.delete(listener) }
    }
  };
  return {
    listeners,
    release,
    change(value: unknown, area = 'sync') { for (const listener of [...listeners]) listener({ [BYLINE_STORAGE_KEY]: { newValue: value } }, area); }
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

afterEach(() => { delete (globalThis as { chrome?: unknown }).chrome; });

describe('author byline setting', () => {
  it('is on unless saved as false', () => {
    assert.equal(resolveBylineEnabled(undefined), true);
    assert.equal(resolveBylineEnabled('false'), true);
    assert.equal(resolveBylineEnabled(0), true);
    assert.equal(resolveBylineEnabled(true), true);
    assert.equal(resolveBylineEnabled(false), false);
  });

  it('is unknown until the first read, then follows sync changes and ignores other areas', async () => {
    const storage = installStorage({ [BYLINE_STORAGE_KEY]: false });
    const setting = watchAuthorBylineSetting();
    let calls = 0;
    setting.subscribe(() => calls++);
    assert.equal(setting.enabled, null);
    storage.release();
    await settle();
    assert.equal(setting.enabled, false);
    storage.change(true);
    assert.equal(setting.enabled, true);
    storage.change(false, 'local');
    assert.equal(setting.enabled, true);
    assert.equal(calls, 2);
    setting.dispose();
    setting.dispose();
    assert.equal(storage.listeners.size, 0);
  });

  it('keeps a change seen before the first read lands', async () => {
    const storage = installStorage({ [BYLINE_STORAGE_KEY]: true });
    const setting = watchAuthorBylineSetting();
    storage.change(false);
    storage.release();
    await settle();
    assert.equal(setting.enabled, false);
    setting.dispose();
  });

  it('applies the default without extension storage', () => {
    const setting = watchAuthorBylineSetting();
    assert.equal(setting.enabled, true);
    setting.dispose();
  });
});
