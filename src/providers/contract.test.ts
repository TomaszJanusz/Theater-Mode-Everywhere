import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NativeTextTrackAdapter } from './native/adapter';
import { DisneyAdapter } from './disney/adapter';
import { PatreonAdapter } from './patreon/adapter';
import { TwitchAdapter } from './twitch/adapter';
import { VimeoAdapter } from './vimeo/adapter';
import { YouTubeAdapter } from './youtube/adapter';
import { readDisneySnapshot } from './disney/main';
import { readPatreonSnapshot } from './patreon/main';
import { readTwitchSnapshot } from './twitch/main';
import { readVimeoSnapshot } from './vimeo/main';
import { readYoutubeSnapshot } from './youtube/main';

const adapters = [
  ['native', NativeTextTrackAdapter],
  ['youtube', YouTubeAdapter],
  ['vimeo', VimeoAdapter],
  ['patreon', PatreonAdapter],
  ['twitch', TwitchAdapter],
  ['disney', DisneyAdapter]
] as const;

const snapshots = [
  ['youtube', readYoutubeSnapshot],
  ['vimeo', readVimeoSnapshot],
  ['patreon', readPatreonSnapshot],
  ['twitch', readTwitchSnapshot],
  ['disney', readDisneySnapshot]
] as const;

describe('provider contracts', () => {
  it('exports an isolated adapter for native and each host', () => {
    for (const [id, Adapter] of adapters) {
      assert.equal(typeof Adapter, 'function', `${id} adapter`);
    }
  });

  it('exports a MAIN snapshot reader for each host provider', () => {
    for (const [id, readSnapshot] of snapshots) {
      assert.equal(typeof readSnapshot, 'function', `${id} snapshot`);
    }
  });
});
