import { installQualityBridge } from '../video-quality-bridge';

import { twitchMediaPlayer, twitchShowsAd, type TwitchMediaPlayer, type TwitchQuality } from './media-player';

function qualities(instance: TwitchMediaPlayer): TwitchQuality[] {
  const list = instance.getQualities?.();
  return Array.isArray(list) ? list.filter((quality): quality is TwitchQuality => Boolean(quality) && typeof quality === 'object') : [];
}

/** The channel, and the recording when the page plays one: a new stream or VOD is another item. */
function mediaId(instance: TwitchMediaPlayer): string | null {
  const login = instance.getLoadedChannelLogin?.();
  if (typeof login !== 'string' || !login) return null;
  const vod = /^\/videos\/(\d+)/.exec(window.location.pathname)?.[1];
  return vod ? `${login}/videos/${vod}` : login;
}

function read(video: HTMLVideoElement): unknown {
  const instance = twitchMediaPlayer(video);
  const id = instance && mediaId(instance);
  // Ads stitched into the stream replace the picture; a pick then changes nothing the viewer can judge.
  if (!instance || !id || twitchShowsAd(video)) return null;
  const current = instance.getQuality?.()?.group;
  return {
    mediaId: id,
    levels: qualities(instance).map(quality => ({ id: quality.group, label: quality.name, height: quality.height })),
    fixed: instance.isAutoQualityMode?.() === true ? null : current,
    playing: current
  };
}

function select(video: HTMLVideoElement, level: string | null): boolean {
  const instance = twitchMediaPlayer(video);
  if (!instance) return false;
  if (level === null) {
    instance.setAutoQualityMode?.(true);
    return instance.isAutoQualityMode?.() === true;
  }
  const quality = qualities(instance).find(candidate => candidate.group === level);
  if (!quality) return false;
  instance.setQuality?.(quality);
  return instance.isAutoQualityMode?.() !== true;
}

export function installTwitchQuality(): void {
  installQualityBridge('twitch', { read, select });
}
