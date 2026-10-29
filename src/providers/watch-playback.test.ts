import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defaultMediaProviderFlags, MEDIA_PROVIDER_IDS } from '../media-features/provider-flags';

import { bilibiliVideoIdentity } from './bilibili/watch-playback';
import { bilibiliIntlVideoIdentity } from './bilibili-intl/watch-playback';
import { patreonWatchPlayback } from './patreon/watch-playback';
import { providerDefinition, shouldAttachProvider } from './registry';
import { providerRegistry } from './runtime-registration';
import { vikiWatchPlayback } from './viki/watch-playback';
import { vimeoWatchPlayback } from './vimeo/watch-playback';
import { autoTheaterAvailability, leftProviderWatchPage, readProviderWatchPage } from './watch-playback';
import { youtubeWatchPlayback } from './youtube/watch-playback';

function read(href: string) {
  const page = readProviderWatchPage(new URL(href));
  return page ? { provider: page.provider, identity: page.identity } : null;
}

describe('positive provider watch declarations', () => {
  it('declares YouTube watch videos and keeps identity stable across incidental navigation', () => {
    const identity = (path: string) => youtubeWatchPlayback.pageIdentity(new URL(`https://www.youtube.com${path}`));
    assert.equal(identity('/watch?v=abcdefghijk'), 'abcdefghijk');
    assert.equal(identity('/watch?v=abcdefghijk&list=playlist&t=120'), 'abcdefghijk');
    for (const path of ['/', '/feed/subscriptions', '/shorts/abcdefghijk', '/embed/abcdefghijk', '/watch', '/watch?v=x', '/watch?v=abcdefghijk/']) {
      assert.equal(identity(path), null, path);
    }
  });

  it('keeps extracted providers unavailable until their host script registers', () => {
    for (const [id, href] of [['soop', 'https://vod.sooplive.com/player/211006561'], ['patreon', 'https://www.patreon.com/posts/my-post-12345678'], ['vimeo', 'https://vimeo.com/123456'], ['youtube', 'https://www.youtube.com/watch?v=abcdefghijk']] as const) {
      assert.equal(providerDefinition(id).watchPlayback, undefined);
      assert.equal(read(href), null);
    }
  });

  it('limits the countdown-only preparing confirmation to providers that declare it', () => {
    assert.deepEqual(MEDIA_PROVIDER_IDS.filter(id => providerDefinition(id).watchPlayback?.preparingVideo), ['twitch', 'bilibili', 'bilibiliIntl', 'iqiyi']);
    assert.ok(youtubeWatchPlayback.preparingVideo);
    assert.ok(patreonWatchPlayback.preparingVideo);
    assert.ok(youtubeWatchPlayback.refreshEvents?.includes('yt-navigate-start'));
  });

  it('declares individual Vimeo clips, excluding feeds, showcases and OTT/live pages', () => {
    for (const href of ['https://vimeo.com/123456', 'https://vimeo.com/123456/abc123', 'https://player.vimeo.com/video/123456']) {
      assert.equal(vimeoWatchPlayback.pageIdentity(new URL(href)), '123456', href);
    }
    for (const href of ['https://vimeo.com/', 'https://vimeo.com/watch', 'https://vimeo.com/showcase/1?video=123456', 'https://vimeo.com/event/123456', 'https://vimeo.com/video/123456']) {
      assert.equal(vimeoWatchPlayback.pageIdentity(new URL(href)), null, href);
    }
  });

  it('declares Twitch VOD pages only, keeping live channels, clips and other routes manual', () => {
    const expected = { provider: 'twitch', identity: '2345678901' };
    for (const href of ['https://www.twitch.tv/videos/2345678901', 'https://www.twitch.tv/videos/2345678901/', 'https://twitch.tv/videos/2345678901?t=1h2m3s&filter=archives']) {
      assert.deepEqual(read(href), expected, href);
    }
    for (const href of ['https://www.twitch.tv/', 'https://www.twitch.tv/somechannel', 'https://www.twitch.tv/somechannel/videos', 'https://www.twitch.tv/somechannel/clip/Slug-abc',
      'https://clips.twitch.tv/Slug-abc', 'https://www.twitch.tv/videos/', 'https://www.twitch.tv/videos/abc', 'https://www.twitch.tv/directory/game/x?video=2345678901',
      'https://player.twitch.tv/?video=2345678901']) {
      assert.equal(read(href), null, href);
    }
  });

  it('declares Patreon post pages only, excluding creator pages, feeds, collections and community routes', () => {
    const expected = { provider: 'patreon', identity: '12345678' };
    for (const href of ['https://www.patreon.com/posts/my-post-12345678', 'https://www.patreon.com/posts/12345678', 'https://www.patreon.com/creator/posts/my-post-12345678/',
      'https://patreon.com/posts/my-post-12345678?utm_source=x&utm_medium=y#comments', 'https://www.patreon.com/posts/12345678/']) {
      assert.equal(patreonWatchPlayback.pageIdentity(new URL(href)), expected.identity, href);
    }
    for (const href of ['https://www.patreon.com/', 'https://www.patreon.com/home', 'https://www.patreon.com/creator', 'https://www.patreon.com/creator/posts', 'https://www.patreon.com/creator/collections',
      'https://www.patreon.com/collection/123', 'https://www.patreon.com/c/creator/posts/my-post-12345678', 'https://www.patreon.com/c/posts/my-post-12345678', 'https://www.patreon.com/posts/my-post',
      'https://www.patreon.com/posts/my-post-12345678/extra', 'https://www.patreon.com/a/b/posts/1', 'https://www.patreon.com/settings', 'https://www.patreon.com/messages/posts/abc123',
      'https://patreon.com.evil.test/posts/my-post-12345678', 'https://creator.patreon.com/posts/my-post-12345678']) {
      assert.equal(patreonWatchPlayback.pageIdentity(new URL(href)), null, href);
    }
  });

  it('never declares arbitrary sites, spoofed hosts, or unqualified providers', () => {
    for (const href of ['https://example.com/watch?v=abcdefghijk', 'https://youtube.com.evil.test/watch?v=abcdefghijk', 'https://twitch.tv.evil.test/videos/123456', 'https://netflix.com.evil.test/watch/123456', 'https://disneyplus.com.evil.test/play/560861a0-55c9-4552-a181-64c498e01b62']) {
      assert.equal(read(href), null, href);
    }
    assert.deepEqual(MEDIA_PROVIDER_IDS.filter(id => providerDefinition(id).watchPlayback), ['twitch', 'disney', 'netflix', 'bilibili', 'bilibiliIntl', 'iqiyi']);
    assert.equal(shouldAttachProvider('youtube', { ...defaultMediaProviderFlags(), youtube: false }, 'www.youtube.com'), false);
  });

  it('qualifies Netflix watch routes independently of tracking, excluding catalog and malformed paths', () => {
    const expected = { provider: 'netflix', identity: '70248299' };
    for (const path of ['/watch/70248299', '/watch/70248299/', '/watch/70248299?trackId=264293154&tctx=Video%3A70178217']) {
      assert.deepEqual(read(`https://www.netflix.com${path}`), expected);
    }
    for (const path of ['/browse', '/title/70178217', '/watch', '/watch/', '/watch/abc', '/watch/70248299/extra', '/browse/watch/70248299']) {
      assert.equal(read(`https://www.netflix.com${path}`), null, path);
    }
  });

  it('qualifies Viki episode routes through a registered watch hook, excluding catalog and spoofed hosts', t => {
    t.mock.method(providerRegistry, 'get', (id: string) => id === 'viki' ? { id: 'viki', contractVersion: 1, watchPlayback: vikiWatchPlayback } : undefined);
    const expected = { provider: 'viki', identity: '1263131v' };
    for (const href of ['https://www.viki.com/videos/1263131v', 'https://www.viki.com/videos/1263131v-legend-of-the-female-general-episode-1',
      'https://viki.com/videos/1263131v/?utm_source=x#t', 'https://www.viki.com/videos/1263131v-slug/']) {
      assert.deepEqual(read(href), expected, href);
    }
    for (const href of ['https://www.viki.com/', 'https://www.viki.com/tv/41125c-legend-of-the-female-general', 'https://www.viki.com/videos/', 'https://www.viki.com/videos/abc',
      'https://www.viki.com/videos/1263131', 'https://www.viki.com/videos/1263131v/extra', 'https://www.viki.com/en/videos/1263131v', 'https://www.viki.com/player/1263131v',
      'https://viki.com.evil.test/videos/1263131v', 'https://www.viki.com:8443/videos/1263131v']) {
      assert.equal(read(href), null, href);
    }
  });

  it('qualifies Disney play routes with optional locale, excluding browse, video and malformed paths', () => {
    const id = '560861a0-55c9-4552-a181-64c498e01b62';
    const expected = { provider: 'disney', identity: id };
    for (const path of [`/play/${id}`, `/pl-pl/play/${id}?contextId=tracking`, `/en/play/${id}/`, `/en-US/play/${id.toUpperCase()}`]) {
      assert.deepEqual(read(`https://www.disneyplus.com${path}`), expected);
    }
    for (const path of ['/pl-pl/browse', `/pl-pl/browse/entity-${id}`, `/video/${id}`, '/pl-pl/play', '/play/not-a-uuid', `/play/${id}a`, `/play/${id}/extra`, `/browse/play/${id}`]) {
      assert.equal(read(`https://www.disneyplus.com${path}`), null, path);
    }
  });
});

describe('AutoTheater availability', () => {
  const flags = defaultMediaProviderFlags();
  it('is available only on hosts whose provider declares watch playback and has its integration on', () => {
    assert.equal(autoTheaterAvailability('www.bilibili.com', flags, true), 'available');
    assert.equal(autoTheaterAvailability('www.bilibili.tv', flags, true), 'available');
    assert.equal(autoTheaterAvailability('www.bilibili.tv', { ...flags, bilibiliIntl: false }, true), 'integrationOff');
    assert.equal(autoTheaterAvailability('www.bilibili.tv', flags, false), 'unsupported');
    assert.equal(autoTheaterAvailability('www.bilibili.com', { ...flags, bilibili: false }, true), 'integrationOff');
    assert.equal(autoTheaterAvailability('www.bilibili.com', flags, false), 'unsupported');
    assert.equal(autoTheaterAvailability('example.com', flags, true), 'unsupported');
    assert.equal(autoTheaterAvailability('www.twitch.tv', flags, true), 'available');
    assert.equal(autoTheaterAvailability('www.viki.com', flags, true), 'unsupported');
    assert.equal(autoTheaterAvailability('www.viki.com', { ...flags, viki: false }, true), 'unsupported');
    assert.equal(autoTheaterAvailability('www.twitch.tv', { ...flags, twitch: false }, true), 'integrationOff');
    assert.equal(autoTheaterAvailability('www.twitch.tv', flags, false), 'unsupported');
    assert.equal(autoTheaterAvailability('example.com', { ...flags, twitch: false }, true), 'unsupported');
    // Extracted providers are available once their host script registers (covered by the browser runtime tests).
    assert.equal(autoTheaterAvailability('www.youtube.com', flags, true), 'unsupported');
    assert.equal(autoTheaterAvailability('www.patreon.com', flags, true), 'unsupported');
    assert.equal(autoTheaterAvailability('vimeo.com', flags, true), 'unsupported');
  });
});

describe('navigation off a watch page', () => {
  it('ends only a session that began on a provider watch page and landed elsewhere', () => {
    const watch = 'https://www.twitch.tv/videos/123456';
    assert.equal(leftProviderWatchPage(true, 'https://www.twitch.tv/search?term=x'), true);
    assert.equal(leftProviderWatchPage(true, 'https://www.twitch.tv/'), true);
    assert.equal(leftProviderWatchPage(true, 'https://www.twitch.tv/videos/654321'), false);
    assert.equal(leftProviderWatchPage(true, watch), false);
    assert.equal(leftProviderWatchPage(false, 'https://www.twitch.tv/'), false);
    assert.equal(leftProviderWatchPage(true, 'https://example.com/page'), true);
    assert.equal(leftProviderWatchPage(false, 'https://example.com/page'), false);
    assert.equal(leftProviderWatchPage(false, watch), false);
    assert.equal(leftProviderWatchPage(true, `${watch}?t=1h2m3s`), false);
    assert.equal(leftProviderWatchPage(true, 'https://www.netflix.com/browse'), true);
    assert.equal(leftProviderWatchPage(true, 'https://www.netflix.com/watch/12345'), false);
    // Manual season playback remains eligible without relaxing automatic content identity.
    assert.equal(readProviderWatchPage(new URL('https://www.bilibili.tv/en/play/1053337')), null);
    assert.equal(leftProviderWatchPage(true, 'https://www.bilibili.tv/en/play/1053337'), false);
    assert.equal(leftProviderWatchPage(true, 'https://www.bilibili.tv/en/play/1053337/11371243'), false);
    assert.equal(leftProviderWatchPage(true, 'https://www.bilibili.tv/en'), true);
  });
});

it('Bilibili video visits include the part and ignore tracking and playback timestamps', () => {
  for (const suffix of ['', '/', '?p=1&t=10', '?spm_id_from=333.1007#reply']) {
    assert.equal(bilibiliVideoIdentity(new URL(`https://www.bilibili.com/video/BV1xx411c7mu${suffix}`)), 'BV1xx411c7mu:1');
  }
  assert.equal(bilibiliVideoIdentity(new URL('https://www.bilibili.com/video/BV1xx411c7mu?p=2')), 'BV1xx411c7mu:2');
  for (const path of ['/', '/video/', '/video/BVbad', '/video/BV1xx411c7mu/extra', '/bangumi/play/ep123', '/video/BV1xx411c7mu?p=0', '/video/BV1xx411c7mu?p=NaN', '/video/BV1xx411c7mu?p=1.5']) {
    assert.equal(bilibiliVideoIdentity(new URL(`https://www.bilibili.com${path}`)), null, path);
  }
  for (const host of ['live.bilibili.com', 'search.bilibili.com', 'www.bilibili.tv', 'www.bilibili.com.evil.test']) {
    assert.equal(bilibiliVideoIdentity(new URL(`https://${host}/video/BV1xx411c7mu`)), null);
  }
});

it('Bilibili.tv identities distinguish uploads and episodes, ignoring locale and tracking', () => {
  for (const locale of ['en', 'id', 'th', 'vi', 'es', 'pt', 'ar', 'ru', 'zh-Hant']) {
    assert.equal(bilibiliIntlVideoIdentity(new URL(`https://www.bilibili.tv/${locale}/video/4801285774384128?bstar_from=home`)), 'ugc:4801285774384128');
    assert.equal(bilibiliIntlVideoIdentity(new URL(`https://www.bilibili.tv/${locale}/play/1053337/11371243/`)), 'ogv:1053337:11371243');
  }
  for (const path of ['/en', '/en/search', '/en/play/1053337', '/en/video/0', '/en/video/123/extra', '/en/play/1/2/extra', '/en/video/NaN']) {
    assert.equal(bilibiliIntlVideoIdentity(new URL(`https://www.bilibili.tv${path}`)), null, path);
  }
  for (const origin of ['http://www.bilibili.tv', 'https://www.bilibili.com', 'https://www.bilibili.tv.evil.test']) {
    assert.equal(bilibiliIntlVideoIdentity(new URL(`${origin}/en/video/123`)), null);
  }
});

describe('YouTube miniplayer identity', () => {
  const miniplayerVideo = youtubeWatchPlayback.miniplayerVideo!;
  const video = {} as HTMLVideoElement;
  function parked(init: { videoData?: unknown; response?: unknown; ad?: boolean; videos?: HTMLVideoElement[]; selector?: string[] } = {}): Document {
    const player = {
      matches: (selector: string) => Boolean(init.ad) && selector.includes('ad-showing'),
      getVideoData: () => ({ video_id: 'videoData' in init ? init.videoData : 'abcdefghijk' }),
      getPlayerResponse: () => ({ videoDetails: { videoId: 'response' in init ? init.response : 'abcdefghijk' } }),
      querySelectorAll: () => init.videos ?? [video]
    };
    return { querySelector: (selector: string) => (selector.startsWith('ytd-app[miniplayer-is-active] ytd-miniplayer') ? player : null) } as unknown as Document;
  }

  it('confirms the parked video only when both player reads agree on a content id', () => {
    assert.deepEqual(miniplayerVideo(parked()), { video, identity: 'abcdefghijk' });
    // getPlayerResponse() lags getVideoData() while the next queue item loads.
    assert.equal(miniplayerVideo(parked({ response: 'lmnopqrstuv' })), null);
    assert.equal(miniplayerVideo(parked({ videoData: '', response: '' })), null);
    assert.equal(miniplayerVideo(parked({ videoData: undefined, response: undefined })), null);
    assert.equal(miniplayerVideo(parked({ videoData: 'not an id', response: 'not an id' })), null);
    // An ad's ids are not the content's, and the player must hold exactly one main video.
    assert.equal(miniplayerVideo(parked({ ad: true })), null);
    assert.equal(miniplayerVideo(parked({ videos: [] })), null);
    assert.equal(miniplayerVideo(parked({ videos: [video, video] })), null);
    // Nothing parked: the miniplayer is closed or the player sits in the watch page.
    assert.equal(miniplayerVideo({ querySelector: () => null } as unknown as Document), null);
  });

  it('is declared by YouTube only', () => {
    // YouTube's comes from its registered hooks; no statically defined provider declares one.
    assert.deepEqual(MEDIA_PROVIDER_IDS.filter(id => providerDefinition(id).watchPlayback?.miniplayerVideo), []);
  });
});
