import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { netflixNextEpisodePreview } from './next-preview';

function video(fields: {
  title?: string;
  episode?: string;
  thumb?: string | null;
  loading?: string | null;
  next?: object | null;
}) {
  return {
    getTitle: () => fields.title,
    getEpisodeTitle: () => fields.episode,
    getEpisodeThumbnail: () => (fields.thumb ? { w: 350, h: 197, url: fields.thumb } : null),
    getLoadingImageUrl: () => fields.loading,
    getNextEpisode: () => fields.next ?? null
  };
}

const thumb = 'https://occ.example/next.webp?r=1';

describe('Netflix next-episode preview', () => {
  it('uses the next episode title and still', () => {
    const preview = netflixNextEpisodePreview(video({
      next: video({ title: 'House of Cards', episode: 'Rozdział 6', thumb })
    }));
    assert.deepEqual(preview, { title: 'House of Cards · Rozdział 6', imageUrl: thumb });
  });

  it('falls back to the loading image and a single title', () => {
    const preview = netflixNextEpisodePreview(video({
      next: video({ title: 'House of Cards', episode: 'House of Cards', loading: thumb })
    }));
    assert.deepEqual(preview, { title: 'House of Cards', imageUrl: thumb });
  });

  it('returns null without a next episode, a title, or an https image', () => {
    assert.equal(netflixNextEpisodePreview(video({})), null);
    assert.equal(netflixNextEpisodePreview(video({ next: video({ episode: 'Rozdział 6' }) })), null);
    assert.equal(netflixNextEpisodePreview(video({
      next: video({ episode: 'Rozdział 6', thumb: 'http://occ.example/next.webp' })
    })), null);
    assert.equal(netflixNextEpisodePreview(null), null);
  });

  it('ignores a next-episode lookup that throws', () => {
    assert.equal(netflixNextEpisodePreview({ getNextEpisode: () => { throw new Error('closed'); } }), null);
  });
});
