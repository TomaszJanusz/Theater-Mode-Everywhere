import { DISNEY_SHADOW_PARENT_CSS } from './disney/stage';
import { rankNetflixTheaterVideos } from './netflix/playback';
import { twitchVideoAbandoned } from './twitch/discovery';
import { injectTencentWasmFrameStyles, tencentVideosShareContainer } from './tencent/stage';

export type ProviderDiscovery = {
  rankBest?(videos: HTMLVideoElement[]): HTMLVideoElement | null;
  prepareShadowRoot?(shadowRoot: ShadowRoot): void;
  extraShadowCss?(): string;
  sharesPlaybackHost?(current: HTMLVideoElement, replacement: HTMLVideoElement): boolean;
  /** A still-connected video the host has emptied for good, which a loaded replacement may supersede. */
  abandonedVideo?(video: HTMLVideoElement): boolean;
};

const providerDiscovery: ProviderDiscovery[] = [
  {
    rankBest: rankNetflixTheaterVideos
  },
  {
    prepareShadowRoot: injectTencentWasmFrameStyles,
    sharesPlaybackHost: tencentVideosShareContainer
  },
  {
    extraShadowCss: () => DISNEY_SHADOW_PARENT_CSS
  },
  {
    abandonedVideo: twitchVideoAbandoned
  }
];

export function providerRankedVideo(videos: HTMLVideoElement[]): HTMLVideoElement | null {
  for (const hook of providerDiscovery) {
    const picked = hook.rankBest?.(videos);
    if (picked) return picked;
  }
  return null;
}

export function prepareProviderShadowRoot(shadowRoot: ShadowRoot): void {
  for (const hook of providerDiscovery) hook.prepareShadowRoot?.(shadowRoot);
}

export function providerShadowCss(): string {
  return providerDiscovery.map((hook) => hook.extraShadowCss?.() ?? '').join('');
}

export function providerSharesPlaybackHost(current: HTMLVideoElement, replacement: HTMLVideoElement): boolean {
  for (const hook of providerDiscovery) {
    if (hook.sharesPlaybackHost && !hook.sharesPlaybackHost(current, replacement)) return false;
  }
  return true;
}

export function providerVideoAbandoned(video: HTMLVideoElement): boolean {
  return providerDiscovery.some((hook) => hook.abandonedVideo?.(video) === true);
}
