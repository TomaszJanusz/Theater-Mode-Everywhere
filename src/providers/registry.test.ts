import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defaultMediaProviderFlags } from '../media-features/provider-flags';

import { isBilibiliHost, isBilibiliIntlHost, isCrunchyrollHost, isDisneyHost, isIqiyiHost, isNetflixHost, isSoopHost, isTencentHost, isYouTubeHost } from './hosts';
import {
  matchingProviders,
  markFetchPatched,
  markMainWorldBooted,
  shouldAttachProvider,
  shouldPatchMainWorld
} from './registry';
import { isVikiHost } from './viki/hosts';

describe('provider registry', () => {
  it('matches provider hosts used for MAIN patches', () => {
    assert.deepEqual(matchingProviders('www.youtube-nocookie.com').filter((id) => id !== 'native'), ['youtube']);
    // Registered providers (YouTube, SOOP) declare `harvest` in their hooks instead of the static gate.
    assert.equal(shouldPatchMainWorld('www.youtube.com'), false);
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

  it('matches YouTube hosts from its descriptor as the hand-written matcher did', () => {
    for (const host of ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'WWW.YOUTUBE.COM', 'www.youtube.com.',
      'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be', 'youtu.be.', 'YOUTU.BE']) assert.equal(isYouTubeHost(host), true, host);
    for (const host of ['youtube.com.evil.test', 'notyoutube.com', 'youtube.co', 'youtu.be.evil.test', 'sub.youtu.be', 'example.com', '']) {
      assert.equal(isYouTubeHost(host), false, host);
    }
    // youtu.be is an exact host: the former blacklist-style normalization also admitted the redirect-only www.youtu.be.
    assert.equal(isYouTubeHost('www.youtu.be'), false);
    assert.deepEqual(matchingProviders('youtu.be'), ['native', 'youtube']);
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

  it('limits iQIYI to iq.com, which needs no MAIN-world patch', () => {
    assert.equal(isIqiyiHost('www.iq.com'), true);
    assert.equal(isIqiyiHost('iq.com.'), true);
    assert.equal(isIqiyiHost('iq.com.evil.test'), false);
    assert.equal(isIqiyiHost('notiq.com'), false);
    assert.equal(isIqiyiHost('www.iqiyi.com'), false);
    assert.deepEqual(matchingProviders('www.iq.com'), ['native', 'iqiyi']);
    assert.equal(shouldPatchMainWorld('www.iq.com'), false);
    assert.equal(shouldAttachProvider('iqiyi', { ...defaultMediaProviderFlags(), iqiyi: false }, 'www.iq.com'), false);
    assert.equal(shouldAttachProvider('iqiyi', defaultMediaProviderFlags(), 'www.iq.com'), true);
    assert.equal(shouldAttachProvider('iqiyi', defaultMediaProviderFlags(), 'www.crunchyroll.com'), false);
  });

  it('limits SOOP to sooplive.com, which needs no MAIN-world response harvesting', () => {
    for (const host of ['www.sooplive.com', 'play.sooplive.com', 'vod.sooplive.com', 'sooplive.com.']) assert.equal(isSoopHost(host), true, host);
    for (const host of ['sooplive.com.evil.test', 'notsooplive.com', 'sooplive.co.kr', 'afreecatv.com']) assert.equal(isSoopHost(host), false, host);
    assert.deepEqual(matchingProviders('play.sooplive.com'), ['native', 'soop']);
    assert.equal(shouldPatchMainWorld('play.sooplive.com'), false);
    assert.equal(shouldAttachProvider('soop', { ...defaultMediaProviderFlags(), soop: false }, 'vod.sooplive.com'), false);
    assert.equal(shouldAttachProvider('soop', defaultMediaProviderFlags(), 'vod.sooplive.com'), true);
    assert.equal(shouldAttachProvider('soop', defaultMediaProviderFlags(), 'www.iq.com'), false);
  });

  it('marks MAIN boot and fetch patches as idempotent', () => {
    const target: Record<symbol, unknown> = {};
    assert.equal(markMainWorldBooted(target), true);
    assert.equal(markMainWorldBooted(target), false);
    assert.equal(markFetchPatched(target), true);
    assert.equal(markFetchPatched(target), false);
  });

  it('limits the Viki provider to viki.com and keeps the MAIN world unpatched', () => {
    assert.equal(isVikiHost('www.viki.com'), true);
    assert.equal(isVikiHost('www.viki.com.'), true);
    assert.equal(isVikiHost('viki.com.evil.test'), false);
    assert.equal(isVikiHost('notviki.com'), false);
    assert.deepEqual(matchingProviders('www.viki.com'), ['native', 'viki']);
    assert.equal(shouldPatchMainWorld('www.viki.com'), false);
    assert.equal(shouldAttachProvider('viki', defaultMediaProviderFlags(), 'www.viki.com'), true);
    assert.equal(shouldAttachProvider('viki', { ...defaultMediaProviderFlags(), viki: false }, 'www.viki.com'), false);
  });
});
