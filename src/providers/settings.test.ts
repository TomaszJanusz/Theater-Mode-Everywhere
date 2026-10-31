import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';

import { createProviderSettings, resolveProviderSettings, type SettingsProvider } from './settings';

const providers: SettingsProvider[] = [{ id: 'sample', settings: [
  { id: 'enabled', type: 'boolean', default: true, label: 'enabled', description: 'description' },
  { id: 'other', type: 'boolean', default: false, label: 'other', description: 'description' }
] }];
const original = globalThis.chrome;
afterEach(() => { globalThis.chrome = original; });

function storage(initial: unknown = undefined) {
  let data = initial;
  const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>();
  const writes: unknown[] = [];
  let read: (() => Promise<object>) | undefined;
  const external = (value: unknown, area = 'sync') => {
    data = value;
    for (const listener of listeners) listener({ providerSettings: { newValue: value } }, area);
  };
  globalThis.chrome = { storage: {
    sync: { get: async () => read ? read() : { providerSettings: data }, set: async (value: { providerSettings: unknown }) => {
      writes.push(value); external(value.providerSettings);
    } },
    onChanged: { addListener: (listener: typeof external) => listeners.add(listener), removeListener: (listener: typeof external) => listeners.delete(listener) }
  } } as unknown as typeof chrome;
  return { writes, listeners, external, defer: (next: () => Promise<object>) => { read = next; } };
}

it('normalizes missing and malformed data with descriptor defaults and accepts only booleans', () => {
  const defaults = { sample: { enabled: true, other: false } };
  for (const value of [undefined, null, [], 0, { sample: [] }, { sample: { enabled: 'false', other: 1 } }]) {
    assert.deepEqual(resolveProviderSettings(value, providers), defaults);
  }
  assert.deepEqual(resolveProviderSettings({ sample: { enabled: false, other: true, unknown: true } }, providers),
    { sample: { enabled: false, other: true } });
});

it('loads without writes, writes only changes in one namespace, preserves other providers and serializes edits', async () => {
  const edge = storage({ future: { enabled: false }, sample: { extra: 'preserved' } });
  const store = createProviderSettings(providers);
  await store.ready;
  assert.deepEqual(edge.writes, []);
  await store.set('sample', 'enabled', true);
  assert.deepEqual(edge.writes, []);
  await Promise.all([store.set('sample', 'enabled', false), store.set('sample', 'other', true)]);
  assert.deepEqual(edge.writes, [
    { providerSettings: { future: { enabled: false }, sample: { extra: 'preserved', enabled: false } } },
    { providerSettings: { future: { enabled: false }, sample: { extra: 'preserved', enabled: false, other: true } } }
  ]);
  edge.external({ sample: { enabled: true, other: true } });
  assert.equal(store.values.sample.enabled, true);
  await assert.rejects(store.set('sample', 'unknown', true), /Unknown/);
  store.dispose(); store.dispose();
  assert.equal(edge.listeners.size, 0);
  await store.set('sample', 'enabled', false);
  assert.equal(edge.writes.length, 2);
});

it('rejects stale initial snapshots, local events and callbacks after disposal', async () => {
  const edge = storage();
  let finish!: (value: object) => void;
  edge.defer(() => new Promise(resolve => { finish = resolve; }));
  const store = createProviderSettings(providers);
  let changes = 0;
  store.subscribe(() => { changes++; });
  edge.external({ sample: { enabled: false } });
  finish({ providerSettings: { sample: { enabled: true } } });
  await store.ready;
  assert.equal(store.values.sample.enabled, false);
  edge.external({ sample: { enabled: true } }, 'local');
  assert.equal(store.values.sample.enabled, false);
  store.dispose();
  const before = changes;
  edge.external({ sample: { enabled: true } });
  assert.equal(changes, before);
  const disposed = createProviderSettings(providers);
  disposed.subscribe(() => { changes++; });
  disposed.dispose();
  finish({ providerSettings: { sample: { enabled: true } } });
  await disposed.ready;
  assert.equal(changes, before);
  assert.equal(edge.listeners.size, 0);
});

it('resolves global AND per-provider AutoTheater with validated defaults and service isolation', async () => {
  const { providerAutoEnabled } = await import('./settings-values');
  for (const global of [false, true]) for (const value of [false, true, undefined, 'false', null]) {
    const settings = { sample: { autoTheater: value }, other: { autoTheater: false } };
    assert.equal(providerAutoEnabled(global, settings, 'sample'), global && value !== false);
    assert.equal(providerAutoEnabled(global, settings, 'other'), false);
    assert.equal(providerAutoEnabled(global, settings, 'missing'), global);
  }
  for (const malformed of [undefined, null, [], 1, { sample: [] }]) {
    assert.equal(providerAutoEnabled(true, malformed, 'sample'), true);
  }
});
