import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { twitchLoadedVideo } from './media-player';

const loaded = (path: unknown) => twitchLoadedVideo({ getPath: () => path });

describe('Twitch loaded video', () => {
  it('names the past broadcast from the VOD playlist the player plays', () => {
    // Shaped like the player's getPath() on a logged-out VOD page (2026-11), query shortened.
    assert.equal(loaded('https://usher.ttvnw.net/vod/v2/2936407922.m3u8?acmb=e30%3D&sig=abc&allow_source=true'), '2936407922');
    assert.equal(loaded('https://usher.ttvnw.net/vod/2936407922.m3u8'), '2936407922');
  });

  it('names none for a live channel, another host or no playlist', () => {
    assert.equal(loaded('https://usher.ttvnw.net/api/v2/channel/hls/ewroon.m3u8?sig=abc'), null);
    assert.equal(loaded('https://usher.example.net/vod/v2/2936407922.m3u8'), null);
    assert.equal(loaded('https://usher.ttvnw.net/vod/v2/2936407922.m3u8.evil'), null);
    assert.equal(loaded(''), null);
    assert.equal(loaded(undefined), null);
    assert.equal(twitchLoadedVideo({}), null);
  });
});
