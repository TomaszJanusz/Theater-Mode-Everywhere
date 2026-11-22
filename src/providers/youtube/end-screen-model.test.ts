import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { normalizeSuggestion, suggestionChannelHref } from './end-screen-model';

// Recorded public, logged-out Chromium DOM, 2026-10-31. Fixture evidence, not an installed-extension pass.
const fixture = readFileSync(new URL('../../../test/host-fixtures/youtube-end-screen.html', import.meta.url), 'utf8');
const fields = { href: 'https://www.youtube.com/watch?v=YQ8wOO9bvps', title: ' A  title ',
  image: 'https://i1.ytimg.com/vi/YQ8wOO9bvps/hqdefault.jpg', channel: ' Channel ', meta: '158\u00a0tys. • 1 dzień temu', duration: '18:06' };

describe('YouTube end-screen normalization (recorded host fixture)', () => {
  it('preserves host language, metadata, supplied CDN URL and duration', () => {
    const item = normalizeSuggestion(fields)!;
    assert.equal(item.title, 'A title');
    assert.equal(item.channel, 'Channel');
    assert.equal(item.meta, '158 tys. • 1 dzień temu');
    assert.equal(item.durationText, '18:06');
    assert.equal(item.thumbnailUrl, fields.image);
    assert.ok(fixture.includes(fields.href));
    assert.ok(fixture.includes(fields.image));
  });
  it('drops non-video destinations, malformed ids, credentials and empty titles', () => {
    for (const href of ['javascript:alert(1)', 'https://evil.test/watch?v=YQ8wOO9bvps', '/@channel', '/watch?v=bad',
      'https://user@www.youtube.com/watch?v=YQ8wOO9bvps']) assert.equal(normalizeSuggestion({ ...fields, href }), null);
    assert.equal(normalizeSuggestion({ ...fields, title: ' ' }), null);
  });
  it('keeps a missing/unsafe image empty, and preserves playlist navigation', () => {
    for (const image of ['', 'data:image/png;base64,x', 'https://evil.test/pixel', 'http://i1.ytimg.com/a']) {
      assert.equal(normalizeSuggestion({ ...fields, image })?.thumbnailUrl, undefined);
    }
    const item = normalizeSuggestion({ ...fields, href: `${fields.href}&list=PL123` })!;
    assert.equal(item.kind, 'playlist');
    assert.ok(item.href?.endsWith('&list=PL123'));
  });
});

describe('YouTube end-screen channel links', () => {
  const item = normalizeSuggestion(fields)!;
  const channel = { videoId: 'YQ8wOO9bvps', name: 'Channel', url: 'https://www.youtube.com/@channel' };
  it('links the channel YouTube\'s data names for the same tile, on YouTube only', () => {
    assert.equal(suggestionChannelHref(item, channel), 'https://www.youtube.com/@channel');
    assert.equal(suggestionChannelHref(item, undefined), undefined);
    // Another name means the reply describes another list; the tile keeps its text.
    assert.equal(suggestionChannelHref(item, { ...channel, name: 'Someone else' }), undefined);
    assert.equal(suggestionChannelHref({ ...item, channel: '' }, channel), undefined);
    for (const url of ['https://evil.test/@channel', 'http://www.youtube.com/@channel', 'javascript:alert(1)',
      'https://user@www.youtube.com/@channel', 'https://www.youtube.com:444/@channel', '/@channel']) {
      assert.equal(suggestionChannelHref(item, { ...channel, url }), undefined, url);
    }
  });
});
