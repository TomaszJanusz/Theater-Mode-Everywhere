import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parsePlaylistSnapshot } from './playlist-panel';

const item = (key: string, extra: Record<string, unknown> = {}) => ({
  key, title: `Title ${key}`, position: 1, byline: 'Channel', duration: '3:00', imageUrl: 'https://i.ytimg.com/vi/a/hq.jpg',
  current: false, playable: true, ...extra
});

describe('parsePlaylistSnapshot', () => {
  it('keeps valid items and normalises text from an untrusted reply', () => {
    const parsed = parsePlaylistSnapshot({ title: '  A\n list ', owner: 'Owner', total: 3,
      items: [item('a', { current: true }), item('b', { title: '  spaced\ttitle ' })] });
    assert.deepEqual(parsed?.items.map(entry => [entry.key, entry.title, entry.current]), [['a', 'Title a', true], ['b', 'spaced title', false]]);
    assert.equal(parsed?.title, 'A list');
    assert.equal(parsed?.total, 3);
  });

  it('drops items without a key or title, duplicate keys and unsafe images', () => {
    const parsed = parsePlaylistSnapshot({ items: [item(''), item('a', { title: '' }), item('b', { imageUrl: 'javascript:alert(1)' }),
      item('b'), item('c', { imageUrl: 'http://i.ytimg.com/x.jpg', position: 0, playable: 'no' })] });
    assert.deepEqual(parsed?.items.map(entry => [entry.key, entry.imageUrl, entry.position, entry.playable]),
      [['b', '', 1, true], ['c', '', null, true]]);
  });

  it('is no list without items, with two current items, or with a bad count', () => {
    assert.equal(parsePlaylistSnapshot(null), null);
    assert.equal(parsePlaylistSnapshot({ items: [] }), null);
    assert.equal(parsePlaylistSnapshot({ items: 'a' }), null);
    assert.equal(parsePlaylistSnapshot({ items: [item('a', { current: true }), item('b', { current: true })] }), null);
    // Endless mixes have no total; nonsense totals read as unknown.
    assert.equal(parsePlaylistSnapshot({ total: -2, items: [item('a')] })?.total, null);
    assert.equal(parsePlaylistSnapshot({ total: 2.5, items: [item('a')] })?.total, null);
  });
});
