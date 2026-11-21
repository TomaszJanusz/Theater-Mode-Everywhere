import { installQualityBridge } from '../video-quality-bridge';

import { twitchLoadedChannel, twitchLoadedVideo, twitchMediaPlayer, twitchShowsAd, type TwitchMediaPlayer, type TwitchQuality } from './media-player';

function qualities(instance: TwitchMediaPlayer): TwitchQuality[] {
  const list = instance.getQualities?.();
  return Array.isArray(list) ? list.filter((quality): quality is TwitchQuality => Boolean(quality) && typeof quality === 'object') : [];
}

/**
 * What the player loaded, not what the URL names: in-app navigation changes the URL before the player switches.
 * A past broadcast is its video id (the player names no channel for one), a live stream its channel.
 */
function mediaId(instance: TwitchMediaPlayer): string | null {
  const vod = twitchLoadedVideo(instance);
  return vod ? `videos/${vod}` : twitchLoadedChannel(instance);
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
