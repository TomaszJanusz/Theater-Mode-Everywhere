import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { twitchChat } from './chat';

const parse = (href: string) => twitchChat.parseLocation(new URL(href));

describe('Twitch chat routes', () => {
  it('recognizes popout and embed chat documents only', () => {
    assert.equal(parse('https://www.twitch.tv/popout/SomeChannel/chat?popout=')?.role, 'chat-document');
    assert.equal(parse('https://www.twitch.tv/embed/SomeChannel/chat?parent=example.com')?.role, 'chat-document');
    assert.equal(parse('https://www.twitch.tv/SomeChannel')?.role, 'watch');
    assert.equal(parse('https://www.twitch.tv/popout/SomeChannel'), null);
    assert.equal(parse('https://www.twitch.tv/videos/12345')?.role, 'watch');
    assert.equal(parse('https://player.twitch.tv/?channel=SomeChannel'), null);
  });

  it('separates a channel from a native video replay', () => {
    assert.deepEqual(parse('https://www.twitch.tv/SomeChannel/'), {
      role: 'watch', provider: 'twitch', contentKey: 'somechannel', kind: 'live'
    });
    assert.deepEqual(parse('https://m.twitch.tv/videos/12345?t=1h2m'), {
      role: 'watch', provider: 'twitch', contentKey: '12345', kind: 'replay'
    });
    assert.deepEqual(parse('https://www.twitch.tv/popout/SomeChannel/chat'), {
      role: 'chat-document', provider: 'twitch', contentKey: 'somechannel'
    });
    assert.equal(parse('https://www.twitch.tv/directory/all'), null);
    assert.equal(parse('https://www.twitch.tv/videos'), null);
    assert.equal(parse('https://www.twitch.tv/SomeChannel/about'), null);
    assert.equal(parse('https://www.twitch.tv/moderator/SomeChannel'), null);
  });

  it('shows chat on watch hosts and keeps chat keys on every Twitch host', () => {
    for (const host of ['www.twitch.tv', 'twitch.tv', 'm.twitch.tv']) assert.equal(twitchChat.matchesHost(host), true, host);
    for (const host of ['player.twitch.tv', 'clips.twitch.tv', 'dashboard.twitch.tv', 'twitch.tv.evil.test', 'example.com']) {
      assert.equal(twitchChat.matchesHost(host), false, host);
    }
    assert.equal(twitchChat.matchesEventHost?.('dashboard.twitch.tv'), true);
    assert.equal(twitchChat.matchesEventHost?.('twitch.tv.evil.test'), false);
  });
});
