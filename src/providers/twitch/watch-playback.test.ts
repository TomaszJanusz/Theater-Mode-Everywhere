import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { twitchWatchPlayback } from './watch-playback';

function video(duration: number): HTMLVideoElement {
  return { duration } as HTMLVideoElement;
}

/** Only the two selectors the provider uses; `player` holds the videos inside the video-ref. */
function documentWith(player: HTMLVideoElement[], all: HTMLVideoElement[] = player): Document {
  return {
    querySelectorAll: (selector: string) => selector === 'video' ? all : player
  } as unknown as Document;
}

describe('Twitch VOD main video', () => {
  const identity = '2345678901';

  it('confirms the single player video, including before its metadata has loaded', () => {
    const vod = video(3600);
    assert.equal(twitchWatchPlayback.mainVideo(documentWith([vod]), identity), vod);
    const loading = video(Number.NaN);
    assert.equal(twitchWatchPlayback.preparingVideo?.(documentWith([loading]), identity), loading);
  });

  it('rejects the previous live channel video during SPA entry', () => {
    assert.equal(twitchWatchPlayback.mainVideo(documentWith([video(Infinity)]), identity), null);
  });

  it('fails closed with no player, several players or an auxiliary video', () => {
    assert.equal(twitchWatchPlayback.mainVideo(documentWith([]), identity), null);
    assert.equal(twitchWatchPlayback.mainVideo(documentWith([video(10), video(10)]), identity), null);
    const main = video(10);
    assert.equal(twitchWatchPlayback.mainVideo(documentWith([main], [main, video(10)]), identity), null);
  });
});
