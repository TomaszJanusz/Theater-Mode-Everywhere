import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { twitchHarvestSnapshotMatchesPage } from './main';

describe('Twitch harvest snapshot binding', () => {
  it('rejects a child snapshot for a different VOD than the top page', () => {
    assert.equal(
      twitchHarvestSnapshotMatchesPage('https://www.twitch.tv/videos/123', '456'),
      false
    );
    assert.equal(
      twitchHarvestSnapshotMatchesPage('https://www.twitch.tv/videos/123', undefined),
      false
    );
  });

  it('accepts a snapshot for the same VOD or when the top page has no VOD id', () => {
    assert.equal(
      twitchHarvestSnapshotMatchesPage('https://www.twitch.tv/videos/123', '123'),
      true
    );
    assert.equal(
      twitchHarvestSnapshotMatchesPage('https://www.twitch.tv/directory', '123'),
      true
    );
  });
});
