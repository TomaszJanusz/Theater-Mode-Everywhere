import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bilibiliVideoIdentity } from './watch-playback';

const identity = (href: string) => bilibiliVideoIdentity(new URL(href));

describe('Bilibili watch-page identity', () => {
  it('names the video and part, with or without a language route', () => {
    assert.equal(identity('https://www.bilibili.com/video/BV1f1J66aEbt/'), 'BV1f1J66aEbt:1');
    assert.equal(identity('https://www.bilibili.com/video/BV1f1J66aEbt?p=3&t=12'), 'BV1f1J66aEbt:3');
    assert.equal(identity('https://www.bilibili.com/zh-Hans/video/BV1f1J66aEbt/'), 'BV1f1J66aEbt:1');
    assert.equal(identity('https://www.bilibili.com/zh-Hant/video/BV1f1J66aEbt/?p=2'), 'BV1f1J66aEbt:2');
    assert.equal(identity('https://www.bilibili.com/en/video/BV1f1J66aEbt'), 'BV1f1J66aEbt:1');
  });

  it('leaves other routes, hosts and malformed parts out', () => {
    for (const href of [
      'https://www.bilibili.com/', 'https://www.bilibili.com/zh-Hans/', 'https://www.bilibili.com/bangumi/play/ep1',
      'https://www.bilibili.com/zh-Hans/bangumi/play/ep1', 'https://www.bilibili.com/zh-Hans/x/video/BV1f1J66aEbt/',
      'https://www.bilibili.com/video/BV1f1J66aEbt/?p=0', 'https://www.bilibili.com/zh-Hans/video/BV1f1J66aEb/',
      'https://space.bilibili.com/zh-Hans/video/BV1f1J66aEbt/', 'http://www.bilibili.com/zh-Hans/video/BV1f1J66aEbt/'
    ]) assert.equal(identity(href), null, href);
  });
});
