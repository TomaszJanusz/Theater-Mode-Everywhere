import assert from 'node:assert/strict';
import { afterEach, it, mock } from 'node:test';

import type { HostCaptionLayoutSource } from '../media-features/types';

import { createHostCaptionLayoutSource } from './host-captions';
import type { ProviderHooks } from './provider-api';
import { providerDefinition } from './registry';
import { providerRegistry } from './runtime-registration';
import { bindProviderPlayback, ensureProviderStages, mountProviderStages, onProviderStructuralMutation, pinProviderViewport, remountProviderStages, unmountProviderStages } from './stage';

const hooks = (): ProviderHooks => ({ id: 'soop', contractVersion: 1,
  watchPlayback: { pageIdentity: () => null, mainVideo: () => null } });
afterEach(() => mock.restoreAll());

it('reads presentation hooks after startup registration and cleans observers before unmount', () => {
  const calls: string[] = [];
  const element = {} as HTMLElement;
  const host = globalThis as { document?: unknown };
  const original = host.document;
  // Legacy stages are idle on this host, but their unconditional teardown still clears document markers.
  host.document = { documentElement: { classList: { remove() {}, contains: () => false } },
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  let registered: ProviderHooks[] = [];
  mock.method(providerRegistry, 'all', () => registered);
  const genericPin = () => calls.push('generic');
  const stage: NonNullable<ProviderHooks['stage']> = {
    mount: () => calls.push('mount'), ensure: () => calls.push('ensure'),
    observe: () => { calls.push('observe'); let active = true; return () => { if (active) calls.push('stop'); active = false; }; },
    unmount: () => calls.push('unmount'),
    claimsViewportPin: () => true, pinViewport: () => calls.push('pin'),
    onStructuralMutation: () => calls.push('mutation'),
    bindPlayback: () => { calls.push('bind'); return () => calls.push('unbind'); }
  };
  try {
    // Factories imported before registration must still see the hooks afterwards.
    registered = [{ ...hooks(), stage }];
    mountProviderStages('example.test', element);
    remountProviderStages('example.test', element);
    ensureProviderStages('example.test', element);
    pinProviderViewport(element, genericPin);
    onProviderStructuralMutation(element, { connected: () => true, refreshAncestors() {} });
    const stop = bindProviderPlayback({ root: element, video: element as HTMLVideoElement,
      current: () => null, pick: () => null, onSwitch() {}, onStabilize() {} });
    stop();
    mountProviderStages('example.test', element);
    unmountProviderStages();
    assert.deepEqual(calls, ['mount', 'observe', 'mount', 'ensure', 'pin', 'mutation', 'bind', 'unbind', 'mount', 'stop', 'observe', 'stop', 'unmount']);
    calls.length = 0;
    registered = [];
    pinProviderViewport(element, genericPin);
    assert.deepEqual(calls, ['generic']);
  } finally {
    if (original === undefined) delete host.document;
    else host.document = original;
  }
});

it('creates independent caption sources without a data integration flag and exposes the page-title policy', () => {
  let created = 0;
  const entry: ProviderHooks = { ...hooks(), titleFromPage: true,
    hostCaptions: (): HostCaptionLayoutSource => {
      let width = ++created;
      return { read: () => width ? { width, height: 10 } : null, reset() { width = 0; } };
    } };
  mock.method(providerRegistry, 'all', () => [entry]);
  mock.method(providerRegistry, 'get', () => entry);
  const first = createHostCaptionLayoutSource()!;
  const second = createHostCaptionLayoutSource()!;
  assert.notEqual(first, second);
  assert.equal(first.read()?.width, 1);
  first.reset?.();
  assert.equal(first.read(), null);
  assert.equal(second.read()?.width, 2, 'reset must not leak into the next adapter');
  assert.equal(providerDefinition('soop').titleFromPage, true);
  delete entry.titleFromPage;
  assert.equal(providerDefinition('soop').titleFromPage, undefined);
  mock.method(providerRegistry, 'all', () => []);
  assert.equal(createHostCaptionLayoutSource(), null);
});
