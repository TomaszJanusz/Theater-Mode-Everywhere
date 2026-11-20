import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { twitchWatchIdentity, twitchWatchPlayback } from './watch-playback';

type FakePlayer = { login?: string; state?: string; broadcast?: string };

/**
 * A video the way Twitch mounts it: its React host carries a fiber whose ancestor, 30 levels up as
 * measured, holds the media player instance that plays into it. `overlay` names a `data-a-target` the
 * player shows over it (an ad label, the content classification gate).
 */
function video(duration: number, player?: FakePlayer, overlay?: string): HTMLVideoElement {
  const element = {
    duration,
    closest: (selector: string) => selector === '.video-player'
      ? { querySelector: (query: string) => overlay && query.includes(`"${overlay}"`) ? {} : null }
      : null
  } as unknown as HTMLVideoElement;
  if (!player) return element;
  const instance = {
    getHTMLVideoElement: () => element,
    getLoadedChannelLogin: () => player.login,
    getState: () => player.state ?? 'Playing',
    getSessionData: () => player.broadcast ? { 'BROADCAST-ID': player.broadcast } : {}
  };
  let fiber: object = { memoizedProps: { mediaPlayerInstance: instance } };
  for (let depth = 0; depth < 30; depth += 1) fiber = { return: fiber, memoizedProps: {} };
  return Object.assign(element, { '__reactFiber$test': { return: fiber } });
}

/** Only the two selectors the provider uses; `player` holds the videos inside the video-ref. */
function documentWith(player: HTMLVideoElement[], all: HTMLVideoElement[] = player): Document {
  return {
    querySelectorAll: (selector: string) => selector === 'video' ? all : player
  } as unknown as Document;
}

const identity = (href: string) => twitchWatchIdentity(new URL(href));

describe('Twitch watch routes', () => {
  it('names a channel page by its lowercased login, without the query string', () => {
    assert.equal(identity('https://www.twitch.tv/hasanabi'), 'live:hasanabi');
    assert.equal(identity('https://www.twitch.tv/HasanAbi/?sr=a'), 'live:hasanabi');
    assert.equal(identity('https://twitch.tv/some_channel_1?referrer=raid'), 'live:some_channel_1');
    assert.equal(identity('https://www.twitch.tv/hasanabi#chat'), 'live:hasanabi');
  });

  it('keeps past broadcasts under their video id', () => {
    assert.equal(identity('https://www.twitch.tv/videos/2345678901'), '2345678901');
    assert.equal(identity('https://www.twitch.tv/videos/2345678901/?t=1h2m'), '2345678901');
  });

  it("leaves Twitch's own routes, channel tabs, clips, embeds and other hosts manual", () => {
    for (const href of [
      'https://www.twitch.tv/',
      'https://www.twitch.tv/directory',
      'https://www.twitch.tv/directory/category/just-chatting',
      'https://www.twitch.tv/DIRECTORY',
      'https://www.twitch.tv/videos',
      'https://www.twitch.tv/search?term=x',
      'https://www.twitch.tv/settings',
      'https://www.twitch.tv/subscriptions',
      'https://www.twitch.tv/drops',
      'https://www.twitch.tv/p/en/legal/terms-of-service/',
      'https://www.twitch.tv/moderator/hasanabi',
      'https://www.twitch.tv/popout/hasanabi/chat',
      'https://www.twitch.tv/popout/hasanabi/player',
      'https://www.twitch.tv/embed/hasanabi/chat',
      'https://www.twitch.tv/hasanabi/videos',
      'https://www.twitch.tv/hasanabi/clips',
      'https://www.twitch.tv/hasanabi/clip/SomeClipSlug-abc',
      'https://www.twitch.tv/hasanabi/about',
      'https://www.twitch.tv/hasanabi/schedule',
      'https://www.twitch.tv/hasan-abi',
      'https://www.twitch.tv/%68asanabi',
      'https://clips.twitch.tv/SomeClipSlug-abc',
      'https://player.twitch.tv/?channel=hasanabi&parent=example.com',
      'https://m.twitch.tv/hasanabi',
      'https://dashboard.twitch.tv/u/hasanabi/home',
      'https://www.twitch.tv.evil.test/hasanabi'
    ]) assert.equal(identity(href), null, href);
  });
});

describe('Twitch VOD main video', () => {
  const vod = '2345678901';

  it('confirms the single player video, including before its metadata has loaded', () => {
    const element = video(3600);
    assert.equal(twitchWatchPlayback.mainVideo(documentWith([element]), vod), element);
    const loading = video(Number.NaN);
    assert.equal(twitchWatchPlayback.preparingVideo?.(documentWith([loading]), vod), loading);
  });

  it('rejects the previous live channel video during SPA entry', () => {
    assert.equal(twitchWatchPlayback.mainVideo(documentWith([video(Infinity, { login: 'hasanabi' })]), vod), null);
  });

  it('fails closed with no player, several players or an auxiliary video', () => {
    assert.equal(twitchWatchPlayback.mainVideo(documentWith([]), vod), null);
    assert.equal(twitchWatchPlayback.mainVideo(documentWith([video(10), video(10)]), vod), null);
    const main = video(10);
    assert.equal(twitchWatchPlayback.mainVideo(documentWith([main], [main, video(10)]), vod), null);
  });

  it('reports no content identity: the URL names the recording', () => {
    assert.equal(twitchWatchPlayback.contentIdentity?.(video(10, { login: 'hasanabi', broadcast: '1' }), vod), null);
  });
});

describe('Twitch live main video', () => {
  const live = 'live:hasanabi';
  const main = (element: HTMLVideoElement, purpose?: 'replacement') => twitchWatchPlayback.mainVideo(documentWith([element]), live, purpose);
  const preparing = (element: HTMLVideoElement) => twitchWatchPlayback.preparingVideo?.(documentWith([element]), live);

  it("confirms the player once it has loaded the URL's channel live", () => {
    const element = video(Infinity, { login: 'hasanabi' });
    assert.equal(main(element), element);
    assert.equal(main(video(Infinity, { login: 'HasanAbi' })) !== null, true, 'logins compare case-insensitively');
  });

  it("rejects the previous channel's stream that keeps playing after SPA navigation", () => {
    const stale = video(Infinity, { login: 'otherchannel' });
    assert.equal(main(stale), null);
    assert.equal(preparing(stale), null);
    assert.equal(main(stale, 'replacement'), null);
  });

  it("rejects an offline channel's autoplaying past broadcast", () => {
    // Measured on offline channel pages: finite duration and no channel login.
    const preview = video(9257.4, {});
    assert.equal(main(preview), null);
    assert.equal(preparing(preview), null);
    assert.equal(main(video(9257.4, { login: 'hasanabi' })), null, 'a finite stream is never the live one');
  });

  it('lets the countdown and replacement start while the stream is still loading; entry waits for it', () => {
    const loading = video(Number.NaN, { login: 'hasanabi', state: 'Buffering' });
    assert.equal(main(loading), null);
    assert.equal(preparing(loading), loading);
    assert.equal(main(loading, 'replacement'), loading);
  });

  it('fails closed without the media player, with several players or an auxiliary video', () => {
    assert.equal(main(video(Infinity)), null);
    const element = video(Infinity, { login: 'hasanabi' });
    assert.equal(twitchWatchPlayback.mainVideo(documentWith([element], [element, video(10)]), live), null);
    assert.equal(twitchWatchPlayback.mainVideo(documentWith([element, video(Infinity, { login: 'hasanabi' })]), live), null);
  });

  it('waits behind the content classification gate, except to keep a manual session on its stream', () => {
    const gated = video(Infinity, { login: 'hasanabi' }, 'content-classification-gate-overlay');
    assert.equal(main(gated), null);
    assert.equal(preparing(gated), null);
    assert.equal(main(gated, 'replacement'), gated);
    const ad = video(Infinity, { login: 'hasanabi' }, 'video-ad-label');
    assert.equal(main(ad), ad, 'an ad break stays part of the visit');
    const vod = video(3600, undefined, 'content-classification-gate-overlay');
    assert.equal(twitchWatchPlayback.mainVideo(documentWith([vod]), '2345678901'), null, 'the same gate covers past broadcasts');
  });

  it('identifies the playing broadcast, never one during an ad or a load', () => {
    const content = (element: HTMLVideoElement) => twitchWatchPlayback.contentIdentity?.(element, live);
    assert.equal(content(video(Infinity, { login: 'hasanabi', broadcast: '321241052636' })), '321241052636');
    assert.equal(content(video(Infinity, { login: 'hasanabi', broadcast: '321241052636' }, 'video-ad-label')), null, 'ad break');
    assert.equal(content(video(Infinity, { login: 'hasanabi', broadcast: '321241052636', state: 'Buffering' })), null);
    assert.equal(content(video(Infinity, { login: 'hasanabi' })), null, 'no session data');
    assert.equal(content(video(Infinity, { login: 'hasanabi', broadcast: 'not-a-number' })), null);
    assert.equal(content(video(Infinity)), null, 'no media player');
  });
});
