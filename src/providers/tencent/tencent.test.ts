import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readTencentSnapshot, tencentContentTitle } from './main';

describe('Tencent RTE', () => {
  it('cleans the marketing suffix exposed after player initialization', () => {
    assert.equal(tencentContentTitle('兰香如故_01_电视剧_高清完整版视频在线观看_腾讯视频'), '兰香如故_01');
    assert.equal(tencentContentTitle('腾讯视频'), null);
  });
  it('imports the episode title and ID without the site or marketing suffix', () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    try {
      globalThis.window = { location: { hostname: 'v.qq.com', pathname: '/x/cover/cover/c4102g9a01t.html' },
        VIDEO_INFO: { vid: 'c4102g9a01t' } } as any;
      globalThis.document = { title: '兰香如故_01_腾讯视频', documentElement: { hasAttribute: () => false } } as any;
      assert.deepEqual(readTencentSnapshot(), { videoId: 'c4102g9a01t', title: '兰香如故_01' });
      globalThis.window = { location: { hostname: 'news.qq.com' } } as any;
      assert.equal(readTencentSnapshot(), null);
      globalThis.window = { location: { hostname: 'v.qq.com' } } as any;
      globalThis.document = { documentElement: { hasAttribute: () => true } } as any;
      assert.equal(readTencentSnapshot(), null);
    } finally {
      globalThis.window = oldWindow; globalThis.document = oldDocument;
    }
  });
});
