import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { twitchLiveChannel } from './channel-header';
import { extractTwitchPayloadFromJson, parseCollaborations } from './page';
import { parseTwitchSnapshot } from './snapshot';

const collaborators = JSON.parse(readFileSync(new URL('../../../test/host-fixtures/twitch-collaborator-list.json', import.meta.url), 'utf8')) as {
  together: { data: { channel: { collaboration: { collaborators: Array<{ status: string; user: { id: string; login: string } }> } } } };
  none: unknown;
};

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

  it('reads a Stream Together session from Twitch\'s collaborator list, in Twitch\'s order', () => {
    assert.deepEqual(parseCollaborations(collaborators.together), [{ channelId: '1020349410', members: [
      { id: '1020349410', channel: 'tallemi_ella', name: 'タルレミエラ',
        avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/b0bf074b-ab52-44ad-aa04-0cf642ee04e8-profile_image-70x70.png' },
      { id: '421179917', channel: 'narupxq', name: '_なるる_',
        avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/2cba1b1c-3d7a-4fd6-b705-59e0d421eae9-profile_image-70x70.png' },
      { id: '494020714', channel: 'be_kooo', name: 'べこぉ',
        avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/8de360ea-bac4-4e80-90e4-2b89ed3dfcbd-profile_image-70x70.png' }
    ] }]);
    assert.deepEqual(parseCollaborations(collaborators.none), [{ channelId: '738000896', members: null }], 'no session clears it');
    assert.deepEqual(parseCollaborations({ data: { video: { id: '5', lengthSeconds: 60 } } }), [], 'other responses name no session');
  });

  it('keeps only active members with channel names, and a session only when it lists the channel itself', () => {
    const edited = structuredClone(collaborators.together);
    const rows = edited.data.channel.collaboration.collaborators;
    rows[1].status = 'INVITED';
    rows[2].user.login = '../evil';
    assert.deepEqual(parseCollaborations(edited)[0].members?.map(member => member.channel), ['tallemi_ella']);
    rows[0].user.id = '1';
    assert.equal(parseCollaborations(edited)[0].members, null);
  });

  it('accepts only channel names as the collaborators MAIN reports', () => {
    const parsed = parseTwitchSnapshot({ collaborators: [{ channel: 'tallemi_ella', name: 'タルレミエラ', avatarUrl: 'https://static-cdn.jtvnw.net/a.png' },
      { channel: 'not a channel' }, 'narupxq', { channel: 'be_kooo', avatarUrl: 7 }] });
    assert.deepEqual(parsed?.collaborators, [{ channel: 'tallemi_ella', name: 'タルレミエラ', avatarUrl: 'https://static-cdn.jtvnw.net/a.png' },
      { channel: 'be_kooo', name: undefined }]);
    assert.equal(parseTwitchSnapshot({ title: 'Solo' })?.collaborators, undefined);
    assert.equal(parseTwitchSnapshot({ channel: 'Not a channel' })?.channel, undefined);
    assert.equal(parseTwitchSnapshot({ channel: 'tallemi_ella' })?.channel, 'tallemi_ella');
  });
});
