import assert from 'node:assert/strict';
import { it } from 'node:test';

import { findProviderTheaterTarget, isProviderPlaybackFrameDocument, openProviderPlaybackSession, ordinaryChildWindows, providerFullscreenTarget, readProviderHostToggle } from './playback-session';
import type { ProviderHooks, ProviderPlayback, ProviderPlaybackSession } from './provider-api';
import { providerRegistry } from './runtime-registration';

function hook(playback: ProviderPlayback): ProviderHooks {
  return { id: 'tencent', contractVersion: 1, playback };
}

it('keeps ordinary frames unless a registered provider owns their window', t => {
  const player = {} as Window;
  const ordinary = {} as Window;
  const root = { querySelectorAll: () => [{ contentWindow: player }, { contentWindow: ordinary }, { contentWindow: null }] } as unknown as ParentNode;
  const all = t.mock.method(providerRegistry, 'all', () => [] as ProviderHooks[]);
  assert.deepEqual(ordinaryChildWindows(root), [player, ordinary]);
  all.mock.mockImplementation(() => [hook({ playerFrameWindows: () => [player] })]);
  assert.deepEqual(ordinaryChildWindows(root), [ordinary]);
});

it('delegates non-video targeting and sessions only while the provider is registered', t => {
  const active = { isConnected: true } as HTMLVideoElement;
  const host = {} as HTMLElement;
  const session = {} as ProviderPlaybackSession;
  const discovery = { findBestVideo: () => active, findAllVideosDeep: () => [] };
  const all = t.mock.method(providerRegistry, 'all', () => [] as ProviderHooks[]);
  assert.equal(findProviderTheaterTarget(discovery), active);
  assert.equal(providerFullscreenTarget(active, () => host), active);
  assert.equal(openProviderPlaybackSession(host, { isCurrent: () => true, onReplacement() {} }), null);
  all.mock.mockImplementation(() => [hook({
    theaterTarget: ({ best }) => { assert.equal(best, active); return host; },
    fullscreenFollowsTarget: true,
    openSession: element => element === host ? session : null
  })]);
  assert.equal(findProviderTheaterTarget(discovery), host);
  assert.equal(providerFullscreenTarget(active, () => host), host);
  assert.equal(openProviderPlaybackSession(host, { isCurrent: () => true, onReplacement() {} }), session);
  all.mock.mockImplementation(() => [hook({ frameDocument: true })]);
  assert.equal(isProviderPlaybackFrameDocument(), true);
  assert.equal(findProviderTheaterTarget(discovery), null);
  all.mock.mockImplementation(() => []);
  assert.equal(isProviderPlaybackFrameDocument(), false);
  assert.equal(findProviderTheaterTarget(discovery), active);
});

it('leaves host-toggle provenance validation with the registered provider', t => {
  const event = { source: {}, origin: 'https://frame.example.test', data: {} };
  const page = { hostname: 'example.test', href: 'https://example.test/', root: {} as ParentNode };
  const result = { action: 'toggle', host: {} as HTMLElement } as const;
  const all = t.mock.method(providerRegistry, 'all', () => [hook({ hostToggle: (incoming, document) => {
    assert.equal(incoming, event); assert.equal(document, page); return result;
  } })]);
  assert.equal(readProviderHostToggle(event, page), result);
  all.mock.mockImplementation(() => []);
  assert.equal(readProviderHostToggle(event, page), null);
});
