import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeVimeoSnapshot } from './snapshot-model';

const thumb = { url: 'https://videoapi-sprites.vimeocdn.com/a.0.webp', width: 4686, height: 2640, frameWidth: 426, frameHeight: 240, columns: 11, frames: 120 };

describe('Vimeo snapshot model', () => {
  it('keeps well-formed probe data', () => {
    assert.deepEqual(normalizeVimeoSnapshot({ videoId: '123', title: 'Clip', duration: 635, chapters: [{ startTime: 0, title: 'Intro' }], thumbPreview: thumb }),
      { videoId: '123', title: 'Clip', duration: 635, chapters: [{ startTime: 0, title: 'Intro' }], thumbPreview: thumb });
  });

  it('drops malformed fields instead of trusting the cross-world shape', () => {
    assert.equal(normalizeVimeoSnapshot(null), null);
    assert.equal(normalizeVimeoSnapshot([]), null);
    const snapshot = normalizeVimeoSnapshot({
      videoId: 5, title: '', duration: Number.NaN,
      chapters: [{ startTime: '3', title: 'x' }, { startTime: 1, title: '' }, null, { startTime: 2, title: 'ok' }],
      thumbPreview: { ...thumb, columns: 'many' }
    });
    assert.deepEqual(snapshot, { videoId: undefined, title: undefined, duration: undefined, chapters: [{ startTime: 2, title: 'ok' }], thumbPreview: undefined });
  });

  it('caps chapters and string lengths', () => {
    const chapters = Array.from({ length: 200 }, (_, index) => ({ startTime: index, title: 'c'.repeat(500) }));
    const snapshot = normalizeVimeoSnapshot({ title: 't'.repeat(900), chapters });
    assert.equal(snapshot?.chapters?.length, 80);
    assert.equal(snapshot?.chapters?.[0].title.length, 120);
    assert.equal(snapshot?.title?.length, 300);
  });
});
