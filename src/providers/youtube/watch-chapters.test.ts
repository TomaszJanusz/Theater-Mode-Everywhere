import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { parseYoutubeMarkerChapters } from '../../media-features/parsers/youtube-chapters';

import { WatchChapterMemory, navigationChapters } from './watch-chapters';

/** The page data of an in-app navigation to a 77-minute video with 17 description chapters (sanitized, chapters only). */
const recorded = JSON.parse(readFileSync(new URL('../../../test/fixtures/youtube-navigation-chapters.json', import.meta.url), 'utf8')) as {
  pageData: { response: Record<string, unknown> };
};
const VIDEO = 'V7n3e1cNgso';
const { pageData } = recorded;

describe('navigationChapters', () => {
  it('reads the chapters of recorded navigation page data', () => {
    const found = navigationChapters(pageData);
    assert.ok(found);
    assert.equal(found.videoId, VIDEO);
    const chapters = parseYoutubeMarkerChapters(found.markers, 4623);
    assert.equal(chapters.length, 17);
    assert.deepEqual(chapters[0], { start: 0, end: 75, title: 'Intro', source: 'youtube-markers', confidence: 'medium' });
    assert.deepEqual(chapters.at(-1), { start: 4568, end: 4623, title: 'Meanest Messages', source: 'youtube-markers', confidence: 'medium' });
  });

  it('records a watch response without chapters as none for its video', () => {
    const plain = { response: { currentVideoEndpoint: { watchEndpoint: { videoId: 'other' } }, playerOverlays: { playerOverlayRenderer: {} } } };
    assert.deepEqual(navigationChapters(plain), { videoId: 'other', markers: [] });
  });

  it('ignores page data that is no watch response or names no video', () => {
    assert.equal(navigationChapters({ ...pageData, response: { ...pageData.response, currentVideoEndpoint: undefined } }), null);
    assert.equal(navigationChapters({ response: { contents: {} } }), null, 'a browse page');
    for (const value of [undefined, null, 'text', 3, [pageData]]) assert.equal(navigationChapters(value), null);
  });
});

describe('WatchChapterMemory', () => {
  const markers = navigationChapters(pageData)?.markers ?? [];

  it('keeps chapters by video, latest wins', () => {
    const memory = new WatchChapterMemory();
    memory.remember(null);
    assert.equal(memory.markers(VIDEO), undefined);
    memory.remember({ videoId: VIDEO, markers });
    assert.equal(memory.markers(VIDEO)?.length, 17);
    assert.equal(memory.markers('other'), undefined, 'another video does not get them');
    memory.remember({ videoId: VIDEO, markers: [] });
    assert.deepEqual(memory.markers(VIDEO), [], 'chapters removed');
  });

  it('forgets the least recently navigated videos beyond its bound', () => {
    const memory = new WatchChapterMemory();
    memory.remember({ videoId: VIDEO, markers });
    for (let i = 0; i < 7; i++) memory.remember({ videoId: `v${i}`, markers });
    memory.remember({ videoId: VIDEO, markers });
    memory.remember({ videoId: 'v7', markers });
    assert.equal(memory.markers(VIDEO)?.length, 17, 'visited again, so kept');
    assert.equal(memory.markers('v0'), undefined);
    assert.equal(memory.markers('v1')?.length, 17);
  });
});
