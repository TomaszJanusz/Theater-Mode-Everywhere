import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { twitchVideoAbandoned } from './discovery';

const globals = globalThis as Record<string, unknown>;
const saved = { window: globals.window, HTMLMediaElement: globals.HTMLMediaElement };

function video(state: { readyState?: number; networkState?: number; error?: object | null; inPlayer?: boolean }): HTMLVideoElement {
  return {
    readyState: state.readyState ?? 0,
    networkState: state.networkState ?? 0,
    error: state.error ?? null,
    closest: (selector: string) => state.inPlayer === false || selector !== '[data-a-target="video-ref"]' ? null : {}
  } as unknown as HTMLVideoElement;
}

describe('Twitch abandoned video after a player reload', () => {
  beforeEach(() => {
    globals.HTMLMediaElement = { HAVE_NOTHING: 0, NETWORK_EMPTY: 0, NETWORK_NO_SOURCE: 3 };
    globals.window = { location: { hostname: 'www.twitch.tv' } };
  });
  afterEach(() => {
    globals.window = saved.window;
    globals.HTMLMediaElement = saved.HTMLMediaElement;
  });

  it('flags an emptied or failed player video', () => {
    assert.equal(twitchVideoAbandoned(video({ networkState: 0 })), true);
    assert.equal(twitchVideoAbandoned(video({ networkState: 3 })), true);
    assert.equal(twitchVideoAbandoned(video({ networkState: 2, error: {} })), true);
  });

  it('keeps a loading, loaded, foreign or off-host video bound', () => {
    assert.equal(twitchVideoAbandoned(video({ networkState: 2 })), false);
    assert.equal(twitchVideoAbandoned(video({ readyState: 4, networkState: 1 })), false);
    assert.equal(twitchVideoAbandoned(video({ inPlayer: false })), false);
    globals.window = { location: { hostname: 'example.com' } };
    assert.equal(twitchVideoAbandoned(video({})), false);
  });
});
