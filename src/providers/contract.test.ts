import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NativeTextTrackAdapter } from './native/adapter';
import { DisneyAdapter } from './disney/adapter';
import { NetflixAdapter } from './netflix/adapter';
import { PatreonAdapter } from './patreon/adapter';
import { TwitchAdapter } from './twitch/adapter';
import { VimeoAdapter } from './vimeo/adapter';
import { YouTubeAdapter } from './youtube/adapter';
import { readDisneySnapshot } from './disney/main';
import { readNetflixSnapshot } from './netflix/main';
import { readPatreonSnapshot } from './patreon/main';
import { readTwitchSnapshot } from './twitch/main';
import { readVimeoSnapshot } from './vimeo/main';
import { readYoutubeSnapshot } from './youtube/main';
import { BilibiliAdapter } from './bilibili/adapter';
import { readBilibiliSnapshot } from './bilibili/main';
import { TencentAdapter } from './tencent/adapter';
import { readTencentSnapshot } from './tencent/main';

const adapters = [
  ['native', NativeTextTrackAdapter],
  ['youtube', YouTubeAdapter],
  ['vimeo', VimeoAdapter],
  ['patreon', PatreonAdapter],
  ['twitch', TwitchAdapter],
  ['disney', DisneyAdapter],
  ['netflix', NetflixAdapter],
  ['bilibili', BilibiliAdapter],
  ['tencent', TencentAdapter]
] as const;

const snapshots = [
  ['youtube', readYoutubeSnapshot],
  ['vimeo', readVimeoSnapshot],
  ['patreon', readPatreonSnapshot],
  ['twitch', readTwitchSnapshot],
  ['disney', readDisneySnapshot],
  ['netflix', readNetflixSnapshot],
  ['bilibili', readBilibiliSnapshot],
  ['tencent', readTencentSnapshot]
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
