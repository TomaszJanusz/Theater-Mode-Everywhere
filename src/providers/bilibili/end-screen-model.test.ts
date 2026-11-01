import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { bilibiliVideoId, normalizeBilibiliCover } from './end-screen-model';

// Recorded public, logged-out Chromium DOM, 2026-11-01. Fixture evidence, not an installed-extension pass.
const fixture = readFileSync(new URL('../../../test/host-fixtures/bilibili-end-screen.html', import.meta.url), 'utf8');

describe('Bilibili end-screen normalization (recorded host fixture)', () => {
  it('resolves the protocol-relative covers the host renders, on its image hosts only', () => {
    const recorded = /url\((\/\/i\d\.hdslb\.com\/[^)]+)\)/.exec(fixture)![1];
    assert.equal(normalizeBilibiliCover(recorded), `https:${recorded}`);
    for (const raw of ['', 'data:image/png;base64,x', 'https://evil.test/a.jpg', 'http://i0.hdslb.com/a.jpg', '//i0.hdslb.com:8443/a.jpg',
      'https://user@i0.hdslb.com/a.jpg', 'https://i0.hdslb.com.evil.test/a.jpg']) assert.equal(normalizeBilibiliCover(raw), undefined, raw);
  });
  it('takes the video id from ordinary video links, locale prefix included, and nothing else', () => {
    assert.equal(bilibiliVideoId('/zh-Hans/video/BV1Sj411y7dj/'), 'BV1Sj411y7dj');
    assert.equal(bilibiliVideoId('https://www.bilibili.com/video/BV1Sj411y7dj?spm_id_from=1'), 'BV1Sj411y7dj');
    for (const href of ['', 'javascript:alert(1)', '//space.bilibili.com/1/', 'https://evil.test/video/BV1Sj411y7dj/',
      'https://www.bilibili.com/bangumi/play/ep1', '/video/av170001', '/video/BV1Sj411y7d/']) assert.equal(bilibiliVideoId(href), null, href);
  });
});
