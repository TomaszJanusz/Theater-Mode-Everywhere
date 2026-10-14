import assert from 'node:assert/strict';
import { it } from 'node:test';
import { harvestBodyFormat, harvestFetchFormatMatches, qualifiesYoutubeHeatmap, qualifyNetworkHarvest, type NetworkHarvestContext } from './network-harvest';

const flags = { youtube: true, disney: true, tencent: true, twitch: true, crunchyroll: true };
const cases = [
  ['www.youtube.com', 'https://www.youtube.com/api/timedtext?v=abc&lang=en', 'timedtext'],
  ['www.youtube.com', 'https://www.youtube.com/youtubei/v1/next', 'heatmap'],
  ['www.disneyplus.com', 'https://disney.api.edge.bamgrid.com/playback', 'disney'],
  ['www.disneyplus.com', 'https://www.disneyplus.com/api/playback', 'disney'],
  ['www.disneyplus.com', 'https://cdn.dssott.com/catalog.json', 'disney'],
  ['www.disneyplus.com', 'https://cdn.dssott.com/thumbnails/movie.bif', 'disney-bif'],
  ['wetv.vip', 'https://play.wetv.vip/getvinfo', 'tencent'],
  ['v.qq.com', 'https://h5vv.video.qq.com/getvinfo', 'tencent'],
  ['www.twitch.tv', 'https://gql.twitch.tv/gql', 'twitch'],
  ['www.twitch.tv', 'https://vod-storyboards.twitch.tv/storyboards/123-info.json', 'twitch-storyboard'],
  ['www.crunchyroll.com', 'https://static.crunchyroll.com/skip-events/production/G12345678.json', 'crunchyroll'],
  ['www.crunchyroll.com', 'https://www.crunchyroll.com/content/v2/cms/objects/G12345678', 'crunchyroll'],
  ['www.crunchyroll.com', 'https://www.crunchyroll.com/playback/v3/G12345678/web/chrome/play', 'crunchyroll']
] as const;

it('qualifies provider endpoints before body work, respecting host and integration flags', () => {
  for (const [hostname, url, target] of cases) {
    const context: NetworkHarvestContext = { hostname, pageUrl: `https://${hostname}/watch?v=abc`, flags };
    assert.equal(qualifyNetworkHarvest(context, url), target, url);
    assert.equal(qualifyNetworkHarvest({ ...context, hostname: 'example.com' }, url), null);
    assert.equal(qualifyNetworkHarvest({ ...context, flags: { youtube: false, disney: false, tencent: false, twitch: false, crunchyroll: false } }, url), null);
    assert.equal(qualifyNetworkHarvest(context, `https://${hostname}/unrelated.json`), null);
  }
});

it('allows URL-less metadata only for host Response fallback providers', () => {
  for (const [hostname, target] of [['www.youtube.com', 'heatmap'], ['www.disneyplus.com', 'disney'], ['www.twitch.tv', 'twitch'], ['wetv.vip', null], ['www.crunchyroll.com', null]] as const) {
    assert.equal(qualifyNetworkHarvest({ hostname, pageUrl: `https://${hostname}/`, flags }, ''), target);
  }
  assert.equal(qualifiesYoutubeHeatmap('www.youtube.com', false, '', 'https://www.youtube.com/watch?v=abc'), false);
  assert.equal(qualifiesYoutubeHeatmap('example.com', true, '', 'https://example.com'), false);
});

it('keeps JSON objects and binary formats on their own materialization paths', () => {
  assert.equal(harvestBodyFormat('disney', 'json'), 'json');
  assert.equal(harvestBodyFormat('twitch', 'blob'), 'blob-text');
  assert.equal(harvestBodyFormat('crunchyroll-bif', 'arraybuffer'), 'binary');
  assert.equal(harvestBodyFormat('disney-bif', 'blob'), 'binary');
  assert.equal(harvestBodyFormat('crunchyroll-bif', 'text'), null);
  assert.equal(harvestBodyFormat('tencent', 'document'), null);
  assert.equal(harvestBodyFormat(null, 'arraybuffer'), null);
});

it('rejects advertised media formats before fetch cloning', () => {
  assert.equal(harvestFetchFormatMatches('disney', 'video/mp4'), false);
  assert.equal(harvestFetchFormatMatches('heatmap', 'text/html; charset=utf-8'), false);
  assert.equal(harvestFetchFormatMatches('tencent', 'application/javascript'), true);
  assert.equal(harvestFetchFormatMatches('timedtext', 'application/json'), true);
  assert.equal(harvestFetchFormatMatches('disney-bif', 'application/octet-stream'), true);
  assert.equal(harvestFetchFormatMatches('tencent', ''), true);
});
