import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { navigationObserver } from '../platform/navigation-visit';

import { createPageVisits } from './page-visits';

/**
 * A page window whose history moves `location`, as SPA hosts do. With `navigationApi`, every committed entry change
 * also fires `currententrychange`, as browsers do whichever method made it.
 */
function fakeWindow(navigationApi: boolean) {
  const handlers = new Map<string, () => void>();
  let url = new URL('https://www.example.test/video/A');
  const location = { get href() { return url.href; }, get pathname() { return url.pathname; }, get search() { return url.search; } };
  const navigation = navigationApi ? new EventTarget() : undefined;
  const commit = (navigationType: string, next?: string | URL | null) => {
    if (next) url = new URL(String(next), url.href);
    navigation?.dispatchEvent(Object.assign(new Event('currententrychange'), { navigationType }));
  };
  const native = {
    pushState: (_state: unknown, _title: string, next?: string | URL | null) => commit('push', next),
    replaceState: (_state: unknown, _title: string, next?: string | URL | null) => commit('replace', next)
  };
  const history = { ...native } as unknown as History;
  const win = { location, history, navigation, addEventListener: (type: string, handler: () => void) => { handlers.set(type, handler); } };
  return { win: win as unknown as Window, location, history, native, commit, fire: (type: string) => handlers.get(type)?.() };
}

/** Visits keyed by path, as Bilibili.tv keys them, following the window's committed navigations. */
function visitsOn(navigationApi: boolean) {
  const page = fakeWindow(navigationApi);
  const visits = createPageVisits(() => page.location.pathname);
  visits.follow(navigationObserver(page.win));
  return { ...page, visits };
}

for (const navigationApi of [true, false]) describe(`page visits ${navigationApi ? 'with' : 'without'} the Navigation API`, () => {
  it('ends a visit on pushState A→B→A, so a read from the first A is not current on the return', () => {
    const { history, visits } = visitsOn(navigationApi);
    const first = visits.current();
    const signal = visits.signal(60_000);
    history.pushState(null, '', '/video/B');
    history.pushState(null, '', '/video/A');
    assert.notEqual(visits.current(), first);
    assert.equal(signal.aborted, true, "the first visit's requests are aborted");
  });

  it('keeps the visit for a tracking-only replace and a hash change, and ends it on page hide', () => {
    const { history, visits, fire, commit } = visitsOn(navigationApi);
    const first = visits.current();
    history.replaceState(null, '', '/video/A?vd_source=tracking');
    commit('push', '#comments');
    fire('hashchange');
    assert.equal(visits.current(), first, 'the same content keeps its visit');
    fire('pagehide');
    assert.notEqual(visits.current(), first, 'page hide always ends it');
  });

  it('ends the visit when the host replaced both history methods and then went A→B→A', () => {
    for (const replacement of ['native', 'foreign'] as const) {
      const { history, native, commit, visits } = visitsOn(navigationApi);
      const first = visits.current();
      const signal = visits.signal(60_000);
      history.pushState = replacement === 'native' ? native.pushState : (_s, _t, url) => commit('push', url);
      history.replaceState = replacement === 'native' ? native.replaceState : (_s, _t, url) => commit('replace', url);
      history.pushState(null, '', '/video/B');
      history.pushState(null, '', '/video/A');
      assert.notEqual(visits.current(), first, replacement);
      assert.equal(signal.aborted, true, replacement);
    }
  });
});

describe('page visits with the Navigation API', () => {
  it('ends the visit on navigations that bypass history, such as an intercepted navigation.navigate() A→B→A', () => {
    const { commit, visits } = visitsOn(true);
    const first = visits.current();
    const signal = visits.signal(60_000);
    commit('push', '/video/B');
    commit('traverse', '/video/A');
    assert.notEqual(visits.current(), first);
    assert.equal(signal.aborted, true);
  });
});

describe('page visits without an observer', () => {
  it('still resamples the key when a read starts', () => {
    const page = fakeWindow(false);
    const visits = createPageVisits(() => page.location.pathname);
    const first = visits.current();
    page.native.pushState(null, '', '/video/B');
    assert.notEqual(visits.current(), first);
  });
});
