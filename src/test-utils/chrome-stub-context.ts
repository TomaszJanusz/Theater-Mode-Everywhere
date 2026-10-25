import type { BrowserContext } from 'playwright';

// The page-level stub in chrome-stub.ts is per page. A test that needs several pages of one
// context to share `chrome.storage.sync` (another tab observing a save) installs this instead:
// `saved` lives in the test, every page reads it through a binding, and a write is broadcast to
// the context's other pages as `onChanged`. Surface: what the player and options page touch.

type Saved = Record<string, unknown>;

/** Context-wide `chrome` for every page opened afterwards; `storage.local` is empty and ignored. */
export async function installContextChromeStub(context: BrowserContext, saved: Saved): Promise<void> {
  await context.exposeBinding('readSettings', () => ({ ...saved }));
  await context.exposeBinding('writeSettings', async (_source, values: Saved) => {
    const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { oldValue: saved[key], newValue }]));
    Object.assign(saved, values);
    await Promise.all(context.pages().map(page => page.evaluate(changes => {
      window.dispatchEvent(new CustomEvent('fixture-storage', { detail: changes }));
    }, changes)));
  });
  await context.addInitScript({ content: `window.__name = fn => fn;
    const listeners = new Set();
    window.addEventListener('fixture-storage', event => listeners.forEach(fn => fn(event.detail, 'sync')));
    const sync = { get: async (_keys, cb) => { const data = await window.readSettings(); cb?.(data); return data; },
      set: values => window.writeSettings(values) };
    window.chrome = { runtime: { getURL: file => file, sendMessage: async () => ({}), onMessage: { addListener() {} }, getManifest: () => ({ version: '2.0.0' }) },
      storage: { sync, local: { get: async () => ({}), set: async () => {} },
        onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) } },
      tabs: { query: async () => [] } };` });
}
