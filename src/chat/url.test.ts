// First: the registry must see a YouTube document before it loads.
import '../test-utils/youtube-node-host';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { providerRegistry } from '../providers/runtime-registration';
import { readLiveChatSource, youtubeChat } from '../providers/youtube/chat';
import { youtubeWatchPlayback } from '../providers/youtube/watch-playback';
import { releaseYouTubeNodeHost } from '../test-utils/youtube-node-host';

import { isChatDocument, isNativeChatHost, parseChatLocation, watchIdentity } from './url';

releaseYouTubeNodeHost();
// YouTube's chat routes reach the shared parser only through its registered hook.
assert.equal(providerRegistry.register({ id: 'youtube', contractVersion: 1, watchPlayback: youtubeWatchPlayback, chat: youtubeChat }), true);

describe('chat document urls', () => {
  it('recognizes the registered provider\'s chat, popout, and replay documents', () => {
    assert.equal(isChatDocument('https://www.youtube.com/live_chat?v=AbCdEfGhIjK&is_popout=1'), true);
    assert.equal(isChatDocument('https://www.youtube.com/live_chat_replay?continuation=abc'), true);
    assert.equal(isChatDocument('https://www.youtube.com/live_chat/'), true);
  });

  it('does not treat watch pages or other hosts as chat documents', () => {
    assert.equal(isChatDocument('https://www.youtube.com/watch?v=AbCdEfGhIjK'), false);
    assert.equal(isChatDocument('https://www.youtube.com/live/AbCdEfGhIjK'), false);
    assert.equal(isChatDocument('https://evil.example/live_chat?v=AbCdEfGhIjK'), false);
    assert.equal(isChatDocument('not a url'), false);
  });
});

describe('watch page selection', () => {
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
    assert.equal(watchIdentity('https://www.youtube.com/watch?v=AbCdEfGhIjK'), 'youtube:AbCdEfGhIjK');
    assert.equal(watchIdentity('https://www.youtube.com/live_chat?v=AbCdEfGhIjK'), '');
  });

  it('treats watch and embed hosts as chat hosts and leaves other subdomains alone', () => {
    assert.equal(isNativeChatHost('https://www.youtube.com/'), true);
    assert.equal(isNativeChatHost('https://www.youtube-nocookie.com/embed/AbCdEfGhIjK'), true);
    assert.equal(isNativeChatHost('https://m.youtube.com/watch?v=AbCdEfGhIjK'), true);
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

it('keeps an unregistered provider unavailable without affecting native hosts', () => {
  assert.equal(parseChatLocation('https://play.sooplive.com/battleland/297994793'), null);
  assert.equal(isNativeChatHost('https://vod.sooplive.com/player/211006561'), false);
});
