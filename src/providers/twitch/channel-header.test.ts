import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { twitchLiveChannel } from './channel-header';
import { extractTwitchPayloadFromJson } from './page';
import { parseTwitchSnapshot } from './snapshot';

describe('Twitch channel identity for the byline', () => {
  it('reads the live channel from twitch.tv/<login> only', () => {
    assert.equal(twitchLiveChannel('https://www.twitch.tv/BLASTPremier'), 'blastpremier');
    assert.equal(twitchLiveChannel('https://m.twitch.tv/quiet_harbor/'), 'quiet_harbor');
    for (const href of [
      'https://www.twitch.tv/videos/2929388789', 'https://www.twitch.tv/blastpremier/videos', 'https://www.twitch.tv/blastpremier/clip/x',
      'https://www.twitch.tv/directory', 'https://www.twitch.tv/', 'https://player.twitch.tv/?channel=blastpremier',
      'https://twitch.tv.evil.example/blastpremier', 'not a url'
    ]) assert.equal(twitchLiveChannel(href), null, href);
  });

  it('keeps the owner of the page\'s video from its metadata, not of other videos in the response', () => {
    const response = { data: { video: { id: '2929388789', lengthSeconds: 3600, title: 'Final', owner: { login: 'BLASTPremier', displayName: 'BLASTPremier' } },
      related: [{ id: '1', lengthSeconds: 60, owner: { login: 'someone_else' } }] } };
    assert.deepEqual(extractTwitchPayloadFromJson(response, '2929388789').owner, { channel: 'blastpremier', name: 'BLASTPremier' });
    assert.equal(extractTwitchPayloadFromJson(response, '999').owner, undefined);
    assert.equal(extractTwitchPayloadFromJson({ video: { id: '5', lengthSeconds: 1, owner: { login: '../evil' } } }, '5').owner, undefined);
  });

  it('accepts only a channel name as the owner MAIN reports', () => {
    assert.deepEqual(parseTwitchSnapshot({ videoId: '5', owner: { channel: 'quiet_harbor', name: 'QuietHarbor' } })?.owner, { channel: 'quiet_harbor', name: 'QuietHarbor' });
    for (const owner of [{ channel: 'not a channel' }, { channel: 7 }, 'quiet_harbor', null]) {
      assert.equal(parseTwitchSnapshot({ videoId: '5', owner })?.owner, undefined, JSON.stringify(owner));
    }
  });
});
