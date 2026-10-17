import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readProviderWatchPage } from './watch-playback';
import { defaultMediaProviderFlags, MEDIA_PROVIDER_IDS } from '../media-features/provider-flags';
import { providerDefinition, shouldAttachProvider } from './registry';

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
    assert.deepEqual(MEDIA_PROVIDER_IDS.filter(id => providerDefinition(id).watchPlayback?.preparingVideo), ['youtube']);
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

  it('never declares arbitrary sites, spoofed hosts, or unqualified providers', () => {
    for (const href of ['https://example.com/watch?v=abcdefghijk', 'https://youtube.com.evil.test/watch?v=abcdefghijk', 'https://www.twitch.tv/videos/123456', 'https://netflix.com.evil.test/watch/123456', 'https://disneyplus.com.evil.test/play/560861a0-55c9-4552-a181-64c498e01b62']) {
      assert.equal(read(href), null, href);
    }
    assert.deepEqual(MEDIA_PROVIDER_IDS.filter(id => providerDefinition(id).watchPlayback), ['youtube', 'vimeo', 'disney', 'netflix']);
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
