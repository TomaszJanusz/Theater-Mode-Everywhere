import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { firstMatchingYoutubeSnapshot as firstMatch, normalizeYoutubeSnapshot } from '../../media-features/youtube-snapshot';
import { MAX_AUTHORS } from '../author-byline';

import { readYoutubeOwner, youtubeAuthors, youtubeEndScreenChannels } from './owner-main';

const CHANNEL = 'UCSMOQeBJ2RAnuFungnQOxLg';
const response = (details: Record<string, unknown> = {}, ownerProfileUrl?: unknown) => ({
  videoDetails: { videoId: 'video-a', title: 'Big Buck Bunny', author: 'Blender', channelId: CHANNEL, ...details },
  microformat: { playerMicroformatRenderer: { ownerProfileUrl } }
});
const owner = { id: CHANNEL, name: 'Blender', url: 'https://www.youtube.com/@BlenderOfficial', avatarUrl: null, verified: false, stat: null };

/** A watch-next response for `videoId` with `renderer` as its owner. */
const watchData = (videoId: string, renderer: unknown) => ({
  currentVideoEndpoint: { watchEndpoint: { videoId } },
  contents: { twoColumnWatchNextResults: { results: { results: { contents: [
    { videoPrimaryInfoRenderer: {} }, { videoSecondaryInfoRenderer: { owner: { videoOwnerRenderer: renderer } } }
  ] } } } }
});

// A recorded collaboration: Saturday Night Live UK with Sky TV.
const collab = JSON.parse(readFileSync(new URL('../../../test/host-fixtures/youtube-collab-owner.json', import.meta.url), 'utf8')) as {
  watch: ReturnType<typeof watchData>;
};
const COLLAB_VIDEO = 'mhZtH3r_KJU';
const SNL_AVATAR = 'JUwoH4RdR6HdJwE4-FCp2eepJgqU-EucnHQdP4Qa39zf62_uSyxCl1wKUXoIKIVk0fCHimPF=s88-c-k-c0x00ffffff-no-rj';
const SKY_AVATAR = 'NnpLpyVrcoHYjrNNOO11yOhjAHNEzxddkm2JhCPjtQPiIHXJ9GnG13p_PlLv5a-ArTlG2xZrvA=s88-c-k-c0x00ffffff-no-rj';
// The player response names only the first channel.
const snl = {
  id: 'UC6en775nhqTdmaZQi9uT16A', name: 'Saturday Night Live UK', url: 'https://www.youtube.com/@SaturdayNightLiveUK',
  avatarUrl: null, verified: false, stat: null
};
/** A "Collaborators" dialog row as YouTube builds it, reduced to the channel link. */
const dialogRow = (browseId: string, content: string) => ({ listItemViewModel: { title: {
  content, commandRuns: [{ onTap: { innertubeCommand: { browseEndpoint: { browseId } } } }]
} } });
const collaborators = (rows: unknown[]) => ({
  navigationEndpoint: { showDialogCommand: { panelLoadingStrategy: { inlineContent: { dialogViewModel: {
    customContent: { listViewModel: { listItems: rows } }
  } } } } }
});

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
    const renderer = {
      navigationEndpoint: { browseEndpoint: { browseId: CHANNEL } },
      thumbnail: { thumbnails: [
        { url: '//yt3.ggpht.com/a=s48', width: 48 }, { url: '//yt3.ggpht.com/a=s176', width: 176 }, { url: '//yt3.ggpht.com/a=s88', width: 88 }
      ] },
      badges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_VERIFIED' } }],
      subscriberCountText: { simpleText: '1.26M subscribers' }
    };
    assert.deepEqual(youtubeAuthors(owner, 'video-a', [watchData('video-a', renderer)]),
      [{ ...owner, avatarUrl: 'https://yt3.ggpht.com/a=s88', verified: true, stat: '1.26M subscribers' }]);
    const otherChannel = { ...renderer, navigationEndpoint: { browseEndpoint: { browseId: 'UCpreviousChannel0000000' } } };
    assert.deepEqual(youtubeAuthors(owner, 'video-a', [watchData('video-a', otherChannel)]), [owner]);
    // Only a response for the same video counts: ytInitialData describes only the tab's first video.
    assert.deepEqual(youtubeAuthors(owner, 'video-b', [watchData('video-a', renderer)]), [owner]);
    assert.deepEqual(youtubeAuthors(owner, 'video-a', [null, {}]), [owner]);
  });

  it('lists every collaborator of a collaboration, in YouTube\'s order, with their own avatars', () => {
    const page = [watchData('video-z', {}), collab.watch];
    assert.deepEqual(youtubeAuthors(snl, COLLAB_VIDEO, page), [
      { ...snl, avatarUrl: `https://yt3.ggpht.com/${SNL_AVATAR}`, verified: true, stat: '324K subscribers' },
      {
        id: 'UCxw5iQs7tt4qbcLa31shZ7Q', name: 'Sky TV', url: 'https://www.youtube.com/@SkyTV',
        avatarUrl: `https://yt3.ggpht.com/${SKY_AVATAR}`, verified: true, stat: '408K subscribers'
      }
    ]);
    // The dialog counts only for the video its response describes, and only when it names the player's channel.
    assert.deepEqual(youtubeAuthors(snl, 'video-b', page), [snl]);
    const stranger = { ...snl, id: 'UCstrangerChannel000000a' };
    assert.deepEqual(youtubeAuthors(stranger, COLLAB_VIDEO, page), [stranger]);
  });

  it('keeps at most the byline\'s limit of collaborators and skips rows without a channel', () => {
    const rows = [
      dialogRow(snl.id, snl.name), { listItemViewModel: { title: { content: 'No channel' } } }, dialogRow('not-a-channel', 'Bad id'),
      ...Array.from({ length: 12 }, (_, index) => dialogRow(`UCcollaborator${String(index).padStart(10, '0')}`, `Channel ${index}`))
    ];
    const authors = youtubeAuthors(snl, COLLAB_VIDEO, [watchData(COLLAB_VIDEO, collaborators(rows))]);
    assert.equal(authors.length, MAX_AUTHORS);
    assert.deepEqual(authors.map(author => author.name).slice(0, 3), ['Saturday Night Live UK', 'Channel 0', 'Channel 1']);
  });

  it('takes authors only from a snapshot of the same video, and checks MAIN\'s published copy again', () => {
    const previous = normalizeYoutubeSnapshot({ videoId: 'video-a', title: 'Old', authors: [{ ...owner, name: 'Previous channel' }] });
    const current = normalizeYoutubeSnapshot({ videoId: 'video-b', title: 'New', authors: [owner, { ...owner, id: 'UCsecond', name: 'Second' }] });
    assert.deepEqual(firstMatch('video-b', [previous, current])?.authors?.map(author => author.name), ['Blender', 'Second']);
    const ownerless = normalizeYoutubeSnapshot({ videoId: 'video-b', title: 'New' });
    assert.equal(firstMatch('video-b', [ownerless, { ...previous!, videoId: 'video-c' }])?.authors, undefined);
    assert.equal(firstMatch('video-b', [ownerless, current])?.authors?.[0]?.name, 'Blender');
    assert.equal(normalizeYoutubeSnapshot({ videoId: 'video-b', authors: [{ ...owner, name: 7 }] })?.authors, undefined);
    assert.equal(normalizeYoutubeSnapshot({ videoId: 'video-b', authors: owner })?.authors, undefined);
    assert.deepEqual(normalizeYoutubeSnapshot({ videoId: 'video-b', authors: [{ ...owner, avatarUrl: 9, verified: 'yes', stat: '1M' }] })?.authors,
      [{ ...owner, avatarUrl: null, verified: false, stat: '1M' }]);
  });
});

// Recorded logged-out watch-next end screen; fixture evidence, not an installed-extension pass.
const endScreen = JSON.parse(readFileSync(new URL('../../../test/host-fixtures/youtube-end-screen-channels.json', import.meta.url), 'utf8')) as {
  watch: { playerOverlays: { playerOverlayRenderer: { endScreen: { watchNextEndScreenRenderer: { results: unknown[] } } } } };
};
const END_VIDEO = 'jNQXAC9IVRw';

describe('YouTube end-screen channels', () => {
  it('links each suggestion with one channel run to its handle page, and leaves a collaboration unlinked', () => {
    assert.deepEqual(youtubeEndScreenChannels(END_VIDEO, [null, endScreen.watch]), [
      { videoId: 'RFahjn6vfYY', name: 'Sthenics Films', url: 'https://www.youtube.com/@sthenicsfilms' },
      { videoId: 'Cv4SyBVeUWA', name: 'World Data 3D', url: 'https://www.youtube.com/@WorldData_3D' },
      { videoId: 'vYx0sjhUSqk', name: 'Gorzka Sława', url: 'https://www.youtube.com/@GorzkaS%C5%82awa' }
    ]);
  });

  it('reads only the response of the video that ended, and checks each run', () => {
    assert.deepEqual(youtubeEndScreenChannels('video-b', [endScreen.watch]), []);
    const results = endScreen.watch.playerOverlays.playerOverlayRenderer.endScreen.watchNextEndScreenRenderer.results;
    const suggestion = (runs: unknown[]) => ({ endScreenVideoRenderer: { videoId: 'aaaaaaaaaaa', shortBylineText: { runs } } });
    const run = (text: string, browseEndpoint: unknown) => ({ text, navigationEndpoint: { browseEndpoint } });
    const watch = (items: unknown[]) => ({ ...endScreen.watch, playerOverlays: { playerOverlayRenderer: { endScreen: {
      watchNextEndScreenRenderer: { results: [...items, ...results.slice(0, 1)] } } } } });
    const channels = youtubeEndScreenChannels(END_VIDEO, [watch([
      suggestion([run('A', { browseId: CHANNEL, canonicalBaseUrl: '//evil.test/x' })]),
      suggestion([run('Two', { browseId: CHANNEL }), run(' and ', null)]),
      suggestion([run('Bad id', { browseId: 'not-a-channel', canonicalBaseUrl: '/@bad' })]),
      suggestion([run(' ', { browseId: CHANNEL })])
    ])]);
    // A path that is not YouTube's falls back to the channel id's page; several runs, a bad id or no name link nothing.
    assert.deepEqual(channels.map(channel => channel.url), [`https://www.youtube.com/channel/${CHANNEL}`, 'https://www.youtube.com/@sthenicsfilms']);
  });
});
