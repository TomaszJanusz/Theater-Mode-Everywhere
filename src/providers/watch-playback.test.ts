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

  it('declares individual Vimeo clips, excluding feeds, showcases and OTT/live pages', () => {
    for (const href of ['https://vimeo.com/123456', 'https://vimeo.com/123456/abc123', 'https://player.vimeo.com/video/123456']) {
      assert.deepEqual(read(href), { provider: 'vimeo', identity: '123456' });
    }
    for (const href of ['https://vimeo.com/', 'https://vimeo.com/watch', 'https://vimeo.com/showcase/1?video=123456', 'https://vimeo.com/event/123456', 'https://vimeo.com/video/123456']) {
      assert.equal(read(href), null, href);
    }
  });

  it('never declares arbitrary sites, spoofed hosts, or unqualified providers', () => {
    for (const href of ['https://example.com/watch?v=abcdefghijk', 'https://youtube.com.evil.test/watch?v=abcdefghijk', 'https://www.twitch.tv/videos/123456', 'https://www.netflix.com/watch/123456']) {
      assert.equal(read(href), null, href);
    }
    assert.deepEqual(MEDIA_PROVIDER_IDS.filter(id => providerDefinition(id).watchPlayback), ['youtube', 'vimeo']);
    assert.equal(shouldAttachProvider('youtube', { ...defaultMediaProviderFlags(), youtube: false }, 'www.youtube.com'), false);
  });
});
