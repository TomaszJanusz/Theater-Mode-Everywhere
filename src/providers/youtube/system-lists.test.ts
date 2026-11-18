import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { systemListTitle, systemListTitleKey } from './system-lists';

const channel = 'uAXFkgsw1L7xaCfnd5JJOw';

describe('YouTube system lists', () => {
  it('recognises the lists YouTube makes itself by their fixed ids', () => {
    assert.equal(systemListTitleKey('TLPQMTcxMTIwMjatLZVOWr-pCg'), 'playlistQueue');
    assert.equal(systemListTitleKey('WL'), 'playlistWatchLater');
    assert.equal(systemListTitleKey('LL'), 'playlistLikedVideos');
    assert.equal(systemListTitleKey(`UU${channel}`), 'playlistChannelUploads');
    assert.equal(systemListTitleKey(`UULF${channel}`), 'playlistChannelVideos');
    assert.equal(systemListTitle('WL'), 'Watch later');
  });

  it('leaves playlists people make, mixes and channel lists it cannot name with YouTube\'s title', () => {
    for (const id of ['PLbpi6ZahtOH6Blw3RGYpWkSByi_T7Rygb', 'RDdQw4w9WgXcQ', `UUSH${channel}`, `UULV${channel}`, 'WLx', 'UU', 'TL', '']) {
      assert.equal(systemListTitleKey(id), null, id);
    }
  });
});
