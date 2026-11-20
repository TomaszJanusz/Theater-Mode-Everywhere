import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { firstMatchingYoutubeSnapshot as firstMatch, normalizeYoutubeSnapshot } from '../../media-features/youtube-snapshot';

import { readYoutubeOwner, withOwnerRenderer } from './owner-main';

const CHANNEL = 'UCSMOQeBJ2RAnuFungnQOxLg';
const response = (details: Record<string, unknown> = {}, ownerProfileUrl?: unknown) => ({
  videoDetails: { videoId: 'video-a', title: 'Big Buck Bunny', author: 'Blender', channelId: CHANNEL, ...details },
  microformat: { playerMicroformatRenderer: { ownerProfileUrl } }
});
const owner = { id: CHANNEL, name: 'Blender', url: 'https://www.youtube.com/@BlenderOfficial', avatarUrl: null, verified: false, stat: null };

describe('YouTube video owner', () => {
  it('names the channel from the player response, linked over https', () => {
    assert.deepEqual(readYoutubeOwner(response({}, 'http://www.youtube.com/@BlenderOfficial')), owner);
    // A profile URL that is not a plain YouTube path falls back to the channel page.
    for (const profile of ['https://evil.example/@x', 'https://www.youtube.com/@x?next=//evil', 42, undefined]) {
      assert.equal(readYoutubeOwner(response({}, profile))?.url, `https://www.youtube.com/channel/${CHANNEL}`);
    }
    for (const details of [{ channelId: 'not-a-channel' }, { channelId: 7 }, { author: '  ' }, { author: undefined }]) {
      assert.equal(readYoutubeOwner(response(details)), null, JSON.stringify(details));
    }
  });

  it('adds the owner renderer\'s avatar, badge and subscribers only when it names the same channel', () => {
    const renderer = (browseId: string) => ({
      querySelector: () => ({ data: {
        navigationEndpoint: { browseEndpoint: { browseId } },
        thumbnail: { thumbnails: [
          { url: '//yt3.ggpht.com/a=s48', width: 48 }, { url: '//yt3.ggpht.com/a=s176', width: 176 }, { url: '//yt3.ggpht.com/a=s88', width: 88 }
        ] },
        badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_VERIFIED' } }],
        subscriberCountText: { simpleText: '1.26M subscribers' }
      } })
    }) as unknown as ParentNode;
    assert.deepEqual(withOwnerRenderer(owner, renderer(CHANNEL)),
      { ...owner, avatarUrl: 'https://yt3.ggpht.com/a=s88', verified: true, stat: '1.26M subscribers' });
    // After an in-app navigation the renderer can still describe the previous video's channel.
    assert.deepEqual(withOwnerRenderer(owner, renderer('UCpreviousChannel0000000')), owner);
    assert.deepEqual(withOwnerRenderer(owner, { querySelector: () => null } as unknown as ParentNode), owner);
  });

  it('takes an owner only from a snapshot of the same video, and checks MAIN\'s published copy again', () => {
    const previous = normalizeYoutubeSnapshot({ videoId: 'video-a', title: 'Old', owner: { ...owner, name: 'Previous channel' } });
    const current = normalizeYoutubeSnapshot({ videoId: 'video-b', title: 'New', owner });
    assert.equal(firstMatch('video-b', [previous, current])?.owner?.name, 'Blender');
    const ownerless = normalizeYoutubeSnapshot({ videoId: 'video-b', title: 'New' });
    assert.equal(firstMatch('video-b', [ownerless, { ...previous!, videoId: 'video-c' }])?.owner, undefined);
    assert.equal(firstMatch('video-b', [ownerless, current])?.owner?.name, 'Blender');
    assert.equal(normalizeYoutubeSnapshot({ videoId: 'video-b', owner: { ...owner, name: 7 } })?.owner, undefined);
    assert.deepEqual(normalizeYoutubeSnapshot({ videoId: 'video-b', owner: { ...owner, avatarUrl: 9, verified: 'yes', stat: '1M' } })?.owner,
      { ...owner, avatarUrl: null, verified: false, stat: '1M' });
  });
});
