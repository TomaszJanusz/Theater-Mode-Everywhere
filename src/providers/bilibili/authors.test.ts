import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkedAuthors, providerAuthorHosts } from '../author-byline';

import { BilibiliAdapter } from './adapter';
import { BILIBILI_AVATAR_HOSTS, parseBilibiliAuthors, readBilibiliAuthors } from './authors';
import { normalizeBilibiliSnapshot, parseBilibiliSnapshot } from './metadata';
import descriptor from './provider.json';

const HOSTS = providerAuthorHosts(descriptor.hosts, BILIBILI_AVATAR_HOSTS);

// Fixture evidence: the shape of `__INITIAL_STATE__` on a live joint upload (BV1WUWz6jEcf, 2026-11-21, nine staff);
// names, ids and faces are made up.
const member = (mid: number, name: string, type = -1) => ({
  mid, title: mid === 1001 ? 'creator' : 'Participated in', name,
  face: `https://i1.hdslb.com/bfs/face/${mid}.jpg`, official: { role: type < 0 ? 0 : 1, title: '', desc: '', type }, follower: 2415840
});
const joint = {
  aid: 117610750477508, cid: 43582361340,
  videoData: {
    aid: 117610750477508, cid: 43582361340, title: 'Who is the killer',
    owner: { mid: 1001, name: 'Creator', face: 'https://i1.hdslb.com/bfs/face/1001.jpg' },
    staff: [member(1001, 'Creator', 0), member(1002, 'Guest one', 0), ...Array.from({ length: 7 }, (_, i) => member(1003 + i, `Guest ${i + 2}`))]
  },
  upData: { mid: '1001', fans: 2415840, Official: { role: 1, title: '', desc: '', type: 0 } }
};

describe('Bilibili authors', () => {
  it('lists a joint upload creator first, in Bilibili order, linked to each space and capped by the byline', () => {
    const authors = readBilibiliAuthors(joint, joint.aid);
    assert.equal(authors.length, 9);
    assert.deepEqual(authors[0], {
      id: '1001', name: 'Creator', url: 'https://space.bilibili.com/1001',
      avatarUrl: 'https://i1.hdslb.com/bfs/face/1001.jpg@96w_96h_1c.webp', verified: true, stat: null
    });
    assert.deepEqual(authors.map(author => author.verified).slice(0, 3), [true, true, false]);
    const shown = checkedAuthors(authors, HOSTS);
    assert.equal(shown.length, 8);
    assert.deepEqual(shown, authors.slice(0, 8), 'space links and hdslb avatars pass the byline boundary unchanged');
  });

  it('names a single owner, verified only when upData describes the same account', () => {
    const single = { ...joint, videoData: { ...joint.videoData, staff: [] } };
    assert.deepEqual(readBilibiliAuthors(single, joint.aid).map(({ id, verified }) => ({ id, verified })), [{ id: '1001', verified: true }]);
    const other = { ...single, upData: { ...joint.upData, mid: '77' } };
    assert.equal(readBilibiliAuthors(other, joint.aid)[0].verified, false);
    const protocolRelative = { ...single, videoData: { ...single.videoData, owner: { ...single.videoData.owner, face: '//i0.hdslb.com/bfs/face/a.png' } } };
    assert.equal(readBilibiliAuthors(protocolRelative, joint.aid)[0].avatarUrl, 'https://i0.hdslb.com/bfs/face/a.png@96w_96h_1c.webp');
  });

  it('names nobody for another video, a licensed episode or malformed accounts', () => {
    // After an in-app navigation the store can still hold the previous video.
    assert.deepEqual(readBilibiliAuthors(joint, 106), []);
    assert.deepEqual(readBilibiliAuthors({ aid: 5, cid: 6, epInfo: { aid: 5, cid: 6, title: 'Episode 1' } }, 5), []);
    const broken = { ...joint, videoData: { ...joint.videoData, staff: [
      { mid: 0, name: 'Zero' }, { mid: '12a', name: 'Text' }, { mid: 1, name: '  ' }, { mid: 2, name: 'Kept', face: 'https://evil.test/a.jpg' }
    ] } };
    assert.deepEqual(readBilibiliAuthors(broken, joint.aid), [
      { id: '2', name: 'Kept', url: 'https://space.bilibili.com/2', avatarUrl: null, verified: false, stat: null }
    ]);
  });

  it('crosses worlds with the snapshot and reaches the adapter with its title', async () => {
    const authors = readBilibiliAuthors(joint, joint.aid).slice(0, 2);
    const snapshot = { ...normalizeBilibiliSnapshot('117610750477508:43582361340', 'Who is the killer', 60, {}, null), authors };
    const crossed = JSON.parse(JSON.stringify(snapshot));
    assert.deepEqual(parseBilibiliSnapshot(crossed), snapshot);
    assert.deepEqual(parseBilibiliAuthors([{ ...authors[0], id: 'x' }, { ...authors[1], name: 5 }, authors[1]]), [authors[1]]);
    const { authors: _authors, ...older } = crossed;
    assert.equal(parseBilibiliSnapshot(older)?.authors, undefined, 'a snapshot without authors stays valid');

    const replies: Array<(value: unknown) => void> = [];
    const adapter = new BilibiliAdapter({
      requestPageFetch: async () => null, parseCaptionPayload: () => [],
      requestProviderProbe: () => new Promise(resolve => replies.push(resolve))
    } as never);
    const loading = adapter.probe();
    assert.equal(adapter.getAuthors(), null);
    replies[0](crossed);
    await loading;
    assert.equal(adapter.getTitle(), 'Who is the killer');
    assert.deepEqual(adapter.getAuthors(), authors);
    adapter.invalidate();
    assert.equal(adapter.getAuthors(), null, 'a new part names nobody until its own snapshot arrives');
    const empty = adapter.probe();
    replies[1]({ ...crossed, authors: [] });
    await empty;
    assert.equal(adapter.getAuthors(), null);
  });
});
