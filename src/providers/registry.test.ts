import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultMediaProviderFlags } from '../media-features/provider-flags';
import {
  matchingProviders,
  markFetchPatched,
  markMainWorldBooted,
  shouldAttachProvider,
  shouldPatchMainWorld
} from './registry';
import { isDisneyHost, isYouTubeHost } from './hosts';
import { readDisneySnapshot } from './disney/main';
import { DisneyAdapter } from './disney/adapter';
import { NativeTextTrackAdapter } from './native/adapter';
import { readPatreonSnapshot } from './patreon/main';
import { PatreonAdapter } from './patreon/adapter';
import { readTwitchSnapshot } from './twitch/main';
import { TwitchAdapter } from './twitch/adapter';
import { readVimeoSnapshot } from './vimeo/main';
import { VimeoAdapter } from './vimeo/adapter';
import { readYoutubeSnapshot } from './youtube/main';
import { YouTubeAdapter } from './youtube/adapter';

describe('provider registry', () => {
  it('matches provider hosts used for MAIN patches', () => {
    assert.deepEqual(matchingProviders('www.youtube-nocookie.com').filter((id) => id !== 'native'), ['youtube']);
    assert.equal(shouldPatchMainWorld('www.youtube.com'), true);
    assert.equal(shouldPatchMainWorld('www.disneyplus.com'), true);
    assert.equal(shouldPatchMainWorld('example.com'), false);
    assert.equal(isYouTubeHost('www.youtube-nocookie.com'), true);
    assert.equal(isDisneyHost('www.disneyplus.com'), true);
  });

  it('honors provider flags when attaching adapters', () => {
    const flags = { ...defaultMediaProviderFlags(), youtube: false };
    assert.equal(shouldAttachProvider('youtube', flags, 'www.youtube.com'), false);
    assert.equal(shouldAttachProvider('vimeo', defaultMediaProviderFlags(), 'player.vimeo.com'), true);
  });

  it('marks MAIN boot and fetch patches as idempotent', () => {
    const target: Record<symbol, unknown> = {};
    assert.equal(markMainWorldBooted(target), true);
    assert.equal(markMainWorldBooted(target), false);
    assert.equal(markFetchPatched(target), true);
    assert.equal(markFetchPatched(target), false);
  });

  it('exposes a MAIN snapshot reader and isolated adapter per provider', () => {
    assert.equal(typeof readYoutubeSnapshot, 'function');
    assert.equal(typeof readVimeoSnapshot, 'function');
    assert.equal(typeof readPatreonSnapshot, 'function');
    assert.equal(typeof readTwitchSnapshot, 'function');
    assert.equal(typeof readDisneySnapshot, 'function');
    assert.equal(typeof YouTubeAdapter, 'function');
    assert.equal(typeof VimeoAdapter, 'function');
    assert.equal(typeof PatreonAdapter, 'function');
    assert.equal(typeof TwitchAdapter, 'function');
    assert.equal(typeof DisneyAdapter, 'function');
    assert.equal(typeof NativeTextTrackAdapter, 'function');
  });
});
