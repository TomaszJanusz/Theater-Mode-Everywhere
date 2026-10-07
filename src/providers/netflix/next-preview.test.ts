import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { netflixNextEpisodePreview, readNetflixNextAvailable, readNetflixNextPreview } from './next-preview';
import { playNetflixNextEpisode, type NetflixPlayerAppApi, type NetflixSessionPlayer } from './session';

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

describe('Netflix next-episode availability', () => {
  const snapshot = (payload: unknown) => ({
    getElementById: () => ({ textContent: JSON.stringify(payload) })
  }) as unknown as Document;

  it('keeps the step when the still is missing and ignores another watch id', () => {
    const bare = snapshot({ videoId: '70248290', available: true });
    assert.equal(readNetflixNextAvailable(bare, '70248290'), true);
    assert.equal(readNetflixNextPreview(bare, '70248290'), null);
    assert.equal(readNetflixNextAvailable(snapshot({ videoId: '80057281', available: true }), '70248290'), false);
    const card = snapshot({
      videoId: '70248290',
      title: 'House of Cards · Rozdział 6',
      imageUrl: 'https://occ.example/next.webp'
    });
    assert.equal(readNetflixNextAvailable(card, '70248290'), true);
    assert.equal(readNetflixNextAvailable(snapshot({
      videoId: '70248290',
      available: false,
      title: 'House of Cards · Rozdział 6'
    }), '70248290'), false);
  });

  it('plays the next episode only for the bound session that still has one', () => {
    let calls = 0;
    const player = {
      getMovieId: () => 70248290,
      playNextEpisode: () => { calls += 1; }
    } as NetflixSessionPlayer;
    const api = {
      getVideoMetadataByVideoId: () => ({ getCurrentVideo: () => ({ getNextEpisode: () => ({ id: 70248291 }) }) })
    } as NetflixPlayerAppApi;
    assert.equal(playNetflixNextEpisode(api, player, '70248290'), true);
    assert.equal(calls, 1);
    assert.equal(playNetflixNextEpisode(api, player, '80057281'), false);
    assert.equal(calls, 1);
    const last = {
      getVideoMetadataByVideoId: () => ({ getCurrentVideo: () => ({ getNextEpisode: () => null }) })
    } as NetflixPlayerAppApi;
    assert.equal(playNetflixNextEpisode(last, player, '70248290'), false);
    assert.equal(calls, 1);
  });
});
