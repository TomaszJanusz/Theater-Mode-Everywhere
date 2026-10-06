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
import { isBilibiliHost, isBilibiliIntlHost, isCrunchyrollHost, isDisneyHost, isNetflixHost, isTencentHost, isYouTubeHost } from './hosts';
import { readDisneySnapshot } from './disney/main';
import { readNetflixSnapshot } from './netflix/main';
import { DisneyAdapter } from './disney/adapter';
import { NetflixAdapter } from './netflix/adapter';
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
    assert.equal(shouldPatchMainWorld('www.netflix.com'), true);
    assert.equal(shouldPatchMainWorld('example.com'), false);
    assert.equal(shouldPatchMainWorld('127.0.0.1'), false);
    assert.equal(isYouTubeHost('www.youtube-nocookie.com'), true);
    assert.equal(isYouTubeHost('www.youtube-nocookie.com.'), true);
    assert.equal(isDisneyHost('www.disneyplus.com'), true);
    assert.equal(isDisneyHost('www.disneyplus.com.'), true);
    assert.equal(isNetflixHost('www.netflix.com'), true);
    assert.equal(isNetflixHost('www.netflix.com.'), true);
  });

  it('honors provider flags when attaching adapters', () => {
    const flags = { ...defaultMediaProviderFlags(), youtube: false };
    assert.equal(shouldAttachProvider('youtube', flags, 'www.youtube.com'), false);
    assert.equal(shouldAttachProvider('vimeo', defaultMediaProviderFlags(), 'player.vimeo.com'), true);
  });

  it('limits Bilibili and Tencent adapters to their own domains', () => {
    assert.equal(isBilibiliHost('player.bilibili.com.'), true);
    assert.equal(isBilibiliHost('bilibili.com.evil.test'), false);
    assert.equal(isTencentHost('v.qq.com'), true);
    assert.equal(isTencentHost('wetv.vip'), true);
    assert.equal(isTencentHost('wetv.vip.evil.test'), false);
    assert.equal(isTencentHost('news.qq.com'), false);
    assert.equal(isTencentHost('v.qq.com.evil.test'), false);
    assert.deepEqual(matchingProviders('www.bilibili.com'), ['native', 'bilibili']);
    assert.deepEqual(matchingProviders('v.qq.com'), ['native', 'tencent']);
    assert.equal(shouldPatchMainWorld('www.bilibili.com'), false);
    assert.equal(shouldPatchMainWorld('v.qq.com'), true);
    assert.deepEqual(matchingProviders('wetv.vip'), ['native', 'tencent']);
    assert.equal(shouldAttachProvider('bilibili', { ...defaultMediaProviderFlags(), bilibili: false }, 'www.bilibili.com'), false);
    assert.equal(isBilibiliHost('www.bilibili.tv'), false);
    assert.equal(isBilibiliIntlHost('www.bilibili.tv.'), true);
    assert.equal(isBilibiliIntlHost('www.bilibili.com'), false);
    assert.equal(isBilibiliIntlHost('bilibili.tv.evil.test'), false);
    assert.equal(isBilibiliIntlHost('notbilibili.tv'), false);
    assert.deepEqual(matchingProviders('www.bilibili.tv'), ['native', 'bilibiliIntl']);
    assert.equal(shouldPatchMainWorld('www.bilibili.tv'), false);
    assert.equal(shouldAttachProvider('bilibili', defaultMediaProviderFlags(), 'www.bilibili.tv'), false);
    assert.equal(shouldAttachProvider('bilibiliIntl', { ...defaultMediaProviderFlags(), bilibiliIntl: false }, 'www.bilibili.tv'), false);
    assert.equal(shouldAttachProvider('tencent', defaultMediaProviderFlags(), 'v.qq.com'), true);
    assert.equal(isCrunchyrollHost('www.crunchyroll.com.'), true);
    assert.equal(isCrunchyrollHost('static.crunchyroll.com'), true);
    assert.equal(isCrunchyrollHost('crunchyroll.com.evil.test'), false);
    assert.equal(isCrunchyrollHost('notcrunchyroll.com'), false);
    assert.deepEqual(matchingProviders('www.crunchyroll.com'), ['native', 'crunchyroll']);
    assert.equal(shouldPatchMainWorld('www.crunchyroll.com'), true);
    assert.equal(shouldPatchMainWorld('static.crunchyroll.com'), true);
    assert.equal(shouldPatchMainWorld('crunchyroll.com.evil.test'), false);
    assert.equal(shouldAttachProvider('crunchyroll', { ...defaultMediaProviderFlags(), crunchyroll: false }, 'www.crunchyroll.com'), false);
    assert.equal(shouldAttachProvider('crunchyroll', defaultMediaProviderFlags(), 'static.crunchyroll.com'), true);
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
    assert.equal(typeof readNetflixSnapshot, 'function');
    assert.equal(typeof YouTubeAdapter, 'function');
    assert.equal(typeof VimeoAdapter, 'function');
    assert.equal(typeof PatreonAdapter, 'function');
    assert.equal(typeof TwitchAdapter, 'function');
    assert.equal(typeof DisneyAdapter, 'function');
    assert.equal(typeof NetflixAdapter, 'function');
    assert.equal(typeof NativeTextTrackAdapter, 'function');
  });
});
