import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isChatDocument, isNativeChatHost, parseChatLocation, readLiveChatSource, watchIdentity } from './url';

describe('chat document urls', () => {
  it('recognizes Twitch and YouTube chat, popout, and replay documents', () => {
    assert.equal(isChatDocument('https://www.twitch.tv/popout/SomeChannel/chat?popout='), true);
    assert.equal(isChatDocument('https://www.twitch.tv/embed/SomeChannel/chat?parent=example.com'), true);
    assert.equal(isChatDocument('https://www.youtube.com/live_chat?v=AbCdEfGhIjK&is_popout=1'), true);
    assert.equal(isChatDocument('https://www.youtube.com/live_chat_replay?continuation=abc'), true);
    assert.equal(isChatDocument('https://www.youtube.com/live_chat/'), true);
  });

  it('does not treat watch pages or other hosts as chat documents', () => {
    assert.equal(isChatDocument('https://www.twitch.tv/SomeChannel'), false);
    assert.equal(isChatDocument('https://www.twitch.tv/popout/SomeChannel'), false);
    assert.equal(isChatDocument('https://www.twitch.tv/videos/12345'), false);
    assert.equal(isChatDocument('https://player.twitch.tv/?channel=SomeChannel'), false);
    assert.equal(isChatDocument('https://www.youtube.com/watch?v=AbCdEfGhIjK'), false);
    assert.equal(isChatDocument('https://www.youtube.com/live/AbCdEfGhIjK'), false);
    assert.equal(isChatDocument('https://evil.example/live_chat?v=AbCdEfGhIjK'), false);
    assert.equal(isChatDocument('not a url'), false);
  });
});

describe('watch page selection', () => {
  it('separates a Twitch channel from a native video replay', () => {
    assert.deepEqual(parseChatLocation('https://www.twitch.tv/SomeChannel/'), {
      role: 'watch', provider: 'twitch', contentKey: 'somechannel', kind: 'live'
    });
    assert.deepEqual(parseChatLocation('https://m.twitch.tv/videos/12345?t=1h2m'), {
      role: 'watch', provider: 'twitch', contentKey: '12345', kind: 'replay'
    });
    assert.equal(parseChatLocation('https://www.twitch.tv/directory/all'), null);
    assert.equal(parseChatLocation('https://www.twitch.tv/videos'), null);
    assert.equal(parseChatLocation('https://www.twitch.tv/SomeChannel/about'), null);
    assert.equal(parseChatLocation('https://www.twitch.tv/moderator/SomeChannel'), null);
    assert.equal(watchIdentity('https://www.twitch.tv/SomeChannel'), 'twitch:somechannel');
    assert.equal(watchIdentity('https://www.twitch.tv/popout/SomeChannel/chat'), '');
  });

  it('accepts YouTube watch, live, and embed routes and ignores chat-only or unrelated routes', () => {
    assert.deepEqual(parseChatLocation('https://www.youtube.com/watch?v=AbCdEfGhIjK&t=12'), {
      role: 'watch', provider: 'youtube', contentKey: 'AbCdEfGhIjK', kind: null
    });
    assert.equal(parseChatLocation('https://www.youtube.com/live/AbCdEfGhIjK')?.contentKey, 'AbCdEfGhIjK');
    assert.equal(parseChatLocation('https://www.youtube.com/@LofiGirl/live')?.contentKey, '/@LofiGirl/live');
    assert.equal(parseChatLocation('https://www.youtube.com/channel/UCabc/live')?.provider, 'youtube');
    assert.equal(parseChatLocation('https://www.youtube-nocookie.com/embed/AbCdEfGhIjK')?.role, 'watch');
    assert.equal(parseChatLocation('https://m.youtube.com/watch?v=AbCdEfGhIjK')?.provider, 'youtube');
    assert.equal(parseChatLocation('https://www.youtube.com/shorts/AbCdEfGhIjK'), null);
    assert.equal(parseChatLocation('https://youtu.be/AbCdEfGhIjK'), null);
    assert.equal(parseChatLocation('https://www.youtube.com/watch'), null);
    assert.equal(parseChatLocation('https://www.youtube.com/watch?v=short'), null);
    assert.equal(parseChatLocation('https://www.youtube.com/live_chat?v=AbCdEfGhIjK')?.role, 'chat-document');
    assert.equal(parseChatLocation('https://music.youtube.com/playlist?list=1'), null);
  });

  it('treats watch and embed hosts as chat hosts and leaves other subdomains alone', () => {
    assert.equal(isNativeChatHost('https://www.twitch.tv/directory/all'), true);
    assert.equal(isNativeChatHost('https://m.twitch.tv/videos/55'), true);
    assert.equal(isNativeChatHost('https://www.youtube.com/'), true);
    assert.equal(isNativeChatHost('https://www.youtube-nocookie.com/embed/AbCdEfGhIjK'), true);
    assert.equal(isNativeChatHost('https://m.youtube.com/watch?v=AbCdEfGhIjK'), true);
    assert.equal(isNativeChatHost('https://player.twitch.tv/?channel=SomeChannel'), false);
    assert.equal(isNativeChatHost('https://clips.twitch.tv/SomeClip'), false);
    assert.equal(isNativeChatHost('https://youtu.be/AbCdEfGhIjK'), false);
    assert.equal(isNativeChatHost('https://example.com/watch?v=AbCdEfGhIjK'), false);
    assert.equal(isNativeChatHost('not a url'), false);
  });
});

describe('live chat frame urls', () => {
  it('accepts only exact live_chat and live_chat_replay paths on a YouTube host', () => {
    assert.deepEqual(readLiveChatSource('https://www.youtube.com/live_chat?v=AbCdEfGhIjK'), {
      kind: 'live', videoId: 'AbCdEfGhIjK'
    });
    assert.deepEqual(readLiveChatSource('//www.youtube.com/live_chat_replay?v=AbCdEfGhIjK'), {
      kind: 'replay', videoId: 'AbCdEfGhIjK'
    });
    assert.deepEqual(readLiveChatSource('/live_chat_replay?continuation=abc'), {
      kind: 'replay', videoId: null
    });
    assert.equal(readLiveChatSource('/live_chat?continuation=abc')?.videoId, null);
    assert.equal(readLiveChatSource('https://www.youtube.com/watch?v=AbCdEfGhIjK&feature=live_chat'), null);
    assert.equal(readLiveChatSource('https://www.youtube.com/live_chat/extra?v=AbCdEfGhIjK'), null);
    assert.equal(readLiveChatSource('https://evil.com/live_chat?v=AbCdEfGhIjK'), null);
    assert.equal(readLiveChatSource(''), null);
  });
});

describe('SOOP watch pages', () => {
  it('names a live broadcast and a recording, and ignores every other SOOP page', () => {
    const live = parseChatLocation('https://play.sooplive.com/BattleLand/297994793?x=1');
    assert.deepEqual([live?.role, live?.provider, live && 'kind' in live ? live.kind : null], ['watch', 'soop', 'live']);
    assert.equal(live?.contentKey.split('/').join(' '), 'battleland 297994793');
    assert.deepEqual(parseChatLocation('https://vod.sooplive.com/player/211006561'), {
      role: 'watch', provider: 'soop', contentKey: '211006561', kind: 'replay'
    });
    assert.equal(watchIdentity('https://play.sooplive.com/battleland/297994793'), 'soop:battleland/297994793');
    for (const href of ['https://play.sooplive.com/battleland', 'https://vod.sooplive.com/player/catch', 'https://www.sooplive.com/station/battleland',
      'http://play.sooplive.com/battleland/297994793', 'https://play.sooplive.com.evil.test/battleland/297994793']) {
      assert.equal(parseChatLocation(href), null, href);
    }
    assert.equal(isChatDocument('https://play.sooplive.com/battleland/297994793'), false);
  });

  it('treats only the player hosts as chat hosts', () => {
    assert.equal(isNativeChatHost('https://play.sooplive.com/battleland/297994793'), true);
    assert.equal(isNativeChatHost('https://vod.sooplive.com/player/211006561'), true);
    assert.equal(isNativeChatHost('https://www.sooplive.com/'), false);
    assert.equal(isNativeChatHost('https://sooplive.com.evil.test/'), false);
  });
});
