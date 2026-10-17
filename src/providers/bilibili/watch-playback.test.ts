import assert from 'node:assert/strict';
import { it } from 'node:test';
import { bilibiliVideoIdentity } from './watch-playback';

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
