import assert from 'node:assert/strict';
import { it } from 'node:test';

import { qualifyDisneyHarvest } from './harvest';

it('qualifies Disney+ metadata and BIF endpoints before body work, only with the integration on', () => {
  for (const [url, target] of [
    ['https://disney.api.edge.bamgrid.com/playback', 'disney'],
    ['https://www.disneyplus.com/api/playback', 'disney'],
    ['https://cdn.dssott.com/catalog.json', 'disney'],
    ['https://cdn.dssott.com/thumbnails/movie.bif', 'disney-bif'],
    // URL-less Response observers support host-created metadata Responses.
    ['', 'disney']
  ] as const) {
    assert.equal(qualifyDisneyHarvest(url, true), target, url);
    assert.equal(qualifyDisneyHarvest(url, false), null, url);
  }
  for (const url of ['https://www.disneyplus.com/unrelated.json', 'https://cdn.dssott.com/thumbnails/DUB_CARD.bif',
    'https://cdn.dssott.com/video/segment.mp4', 'https://evil.test/api/playback']) {
    assert.equal(qualifyDisneyHarvest(url, true), null, url);
  }
});
