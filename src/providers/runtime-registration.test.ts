import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { ProviderHooks } from './provider-api';
import { createProviderRegistry } from './runtime-registration';

const hooks = (): ProviderHooks => ({ id: 'soop', contractVersion: 1,
  watchPlayback: { pageIdentity: () => null, mainVideo: () => null }, allowsMediaFetch: () => false });

it('accepts one host-scoped registration, rejects mismatched hosts and fails closed on conflicts', () => {
  const registry = createProviderRegistry('vod.sooplive.com');
  const first = hooks();
  assert.equal(registry.state('soop'), 'unregistered');
  assert.equal(createProviderRegistry('www.youtube.com').register(first), false);
  assert.equal(createProviderRegistry('sooplive.com.evil.test').register(first), false);
  assert.equal(registry.register(first), true);
  assert.equal(registry.register(first), true);
  assert.equal(registry.register(hooks()), false);
  assert.equal(registry.get('soop'), undefined);
  assert.equal(registry.state('soop'), 'failed');
  assert.equal(registry.register(first), false);
});

it('rejects incompatible contracts and removes failed hooks before startup', () => {
  const registry = createProviderRegistry('play.sooplive.com.');
  const incompatible = { ...hooks(), contractVersion: 2 };
  // Deliberately exercise a separately bundled script with an incompatible contract.
  assert.equal(registry.register(incompatible as ProviderHooks), false);
  assert.equal(registry.state('soop'), 'failed');
  const ready = createProviderRegistry('play.sooplive.com');
  assert.equal(ready.register(hooks()), true);
  ready.fail('soop');
  ready.fail('soop');
  assert.deepEqual(ready.all(), []);
  assert.equal(ready.start(), true);
  assert.equal(ready.register(hooks()), false);
});
