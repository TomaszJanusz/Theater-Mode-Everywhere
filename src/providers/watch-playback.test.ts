import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defaultMediaProviderFlags, MEDIA_PROVIDER_IDS } from '../media-features/provider-flags';

import { bilibiliVideoIdentity } from './bilibili/watch-playback';
import { bilibiliIntlVideoIdentity } from './bilibili-intl/watch-playback';
import { providerDefinition, shouldAttachProvider } from './registry';
import { autoTheaterAvailability, readProviderWatchPage } from './watch-playback';

function read(href: string) {
  const page = readProviderWatchPage(new URL(href));
  return page ? { provider: page.provider, identity: page.identity } : null;
}

describe('positive provider watch declarations', () => {
  it('declares YouTube watch videos and keeps identity stable across incidental navigation', () => {
    const expected = { provider: 'youtube', identity: 'abcdefghijk' };
    assert.deepEqual(read('https://www.youtube.com/watch?v=abcdefghijk'), expected);
    assert.deepEqual(read('https://www.youtube.com/watch?v=abcdefghijk&list=playlist&t=120'), expected);
    for (const path of ['/', '/feed/subscriptions', '/shorts/abcdefghijk', '/embed/abcdefghijk', '/watch', '/watch?v=x', '/watch?v=abcdefghijk/']) {
      assert.equal(read(`https://www.youtube.com${path}`), null, path);
    }
  });

  it('limits the countdown-only preparing confirmation to providers that declare it', () => {
    assert.deepEqual(MEDIA_PROVIDER_IDS.filter(id => providerDefinition(id).watchPlayback?.preparingVideo), ['youtube', 'patreon', 'twitch', 'bilibili', 'bilibiliIntl']);
    assert.ok(providerDefinition('youtube').watchPlayback?.refreshEvents?.includes('yt-navigate-start'));
  });

  it('declares individual Vimeo clips, excluding feeds, showcases and OTT/live pages', () => {
    for (const href of ['https://vimeo.com/123456', 'https://vimeo.com/123456/abc123', 'https://player.vimeo.com/video/123456']) {
      assert.deepEqual(read(href), { provider: 'vimeo', identity: '123456' });
    }
    for (const href of ['https://vimeo.com/', 'https://vimeo.com/watch', 'https://vimeo.com/showcase/1?video=123456', 'https://vimeo.com/event/123456', 'https://vimeo.com/video/123456']) {
      assert.equal(read(href), null, href);
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
      assert.deepEqual(read(href), expected, href);
    }
    for (const href of ['https://www.patreon.com/', 'https://www.patreon.com/home', 'https://www.patreon.com/creator', 'https://www.patreon.com/creator/posts', 'https://www.patreon.com/creator/collections',
      'https://www.patreon.com/collection/123', 'https://www.patreon.com/c/creator/posts/my-post-12345678', 'https://www.patreon.com/c/posts/my-post-12345678', 'https://www.patreon.com/posts/my-post',
      'https://www.patreon.com/posts/my-post-12345678/extra', 'https://www.patreon.com/a/b/posts/1', 'https://www.patreon.com/settings', 'https://www.patreon.com/messages/posts/abc123',
      'https://patreon.com.evil.test/posts/my-post-12345678', 'https://creator.patreon.com/posts/my-post-12345678']) {
      assert.equal(read(href), null, href);
    }
  });

  it('never declares arbitrary sites, spoofed hosts, or unqualified providers', () => {
    for (const href of ['https://example.com/watch?v=abcdefghijk', 'https://youtube.com.evil.test/watch?v=abcdefghijk', 'https://twitch.tv.evil.test/videos/123456', 'https://netflix.com.evil.test/watch/123456', 'https://disneyplus.com.evil.test/play/560861a0-55c9-4552-a181-64c498e01b62']) {
      assert.equal(read(href), null, href);
    }
    assert.deepEqual(MEDIA_PROVIDER_IDS.filter(id => providerDefinition(id).watchPlayback), ['youtube', 'vimeo', 'patreon', 'twitch', 'disney', 'netflix', 'bilibili', 'bilibiliIntl']);
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
    assert.equal(autoTheaterAvailability('www.youtube.com', flags, true), 'available');
    assert.equal(autoTheaterAvailability('www.bilibili.com', flags, true), 'available');
    assert.equal(autoTheaterAvailability('www.bilibili.tv', flags, true), 'available');
    assert.equal(autoTheaterAvailability('www.bilibili.tv', { ...flags, bilibiliIntl: false }, true), 'integrationOff');
    assert.equal(autoTheaterAvailability('www.bilibili.tv', flags, false), 'unsupported');
    assert.equal(autoTheaterAvailability('www.bilibili.com', { ...flags, bilibili: false }, true), 'integrationOff');
    assert.equal(autoTheaterAvailability('www.bilibili.com', flags, false), 'unsupported');
    assert.equal(autoTheaterAvailability('example.com', flags, true), 'unsupported');
    assert.equal(autoTheaterAvailability('www.patreon.com', flags, true), 'available');
    assert.equal(autoTheaterAvailability('www.patreon.com', { ...flags, patreon: false }, true), 'integrationOff');
    assert.equal(autoTheaterAvailability('www.twitch.tv', flags, true), 'available');
    assert.equal(autoTheaterAvailability('www.twitch.tv', { ...flags, twitch: false }, true), 'integrationOff');
    assert.equal(autoTheaterAvailability('www.youtube.com', flags, false), 'unsupported');
    assert.equal(autoTheaterAvailability('www.youtube.com', { ...flags, youtube: false }, true), 'integrationOff');
    assert.equal(autoTheaterAvailability('example.com', { ...flags, youtube: false }, true), 'unsupported');
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
