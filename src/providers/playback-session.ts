import { isInactiveStandbyVideo, isOnMiniplayerSurface, selectSwitchableVideos } from '../switchable-videos';
import type { ProviderPlaybackSession } from './provider-api';
import { providerRegistry } from './runtime-registration';
import { readMiniplayerIdentity } from './watch-playback';

export type { ProviderPlaybackSession } from './provider-api';

const playbackHooks = () => providerRegistry.all().flatMap(hooks => hooks.playback ?? []);

export function isProviderPlaybackFrameDocument(): boolean {
  return playbackHooks().some(hooks => hooks.frameDocument);
}

export function readProviderHostToggle(
  event: { source: unknown; origin: string; data: unknown },
  page: { hostname: string; href: string; root: ParentNode }
): { action: 'toggle' | 'fullscreen'; host: HTMLElement } | null {
  for (const hooks of playbackHooks()) {
    const toggle = hooks.hostToggle?.(event, page);
    if (toggle) return toggle;
  }
  return null;
}

/** Ordinary child frames exclude provider-owned player frames, whose messages use a separate protocol. */
export function ordinaryChildWindows(root: ParentNode): Window[] {
  const hidden = new Set(playbackHooks().flatMap(hooks => hooks.playerFrameWindows?.(root) ?? []));
  return Array.from(root.querySelectorAll('iframe')).flatMap(frame => frame.contentWindow && !hidden.has(frame.contentWindow) ? [frame.contentWindow] : []);
}

/** A parked miniplayer video whose identity the host player confirms; never a discovery candidate. */
export function isMiniplayerTarget(video: HTMLVideoElement): boolean {
  return window === window.top && isOnMiniplayerSurface(video) && readMiniplayerIdentity(video) !== null;
}

export function findProviderTheaterTarget(discovery: {
  findBestVideo(): HTMLVideoElement | null;
  findAllVideosDeep(): HTMLVideoElement[];
  /** The video under the pointer or chosen with the launcher, if any. */
  pointed?: HTMLVideoElement | null;
}): HTMLElement | null {
  if (isProviderPlaybackFrameDocument()) return null;
  const custom = playbackHooks().filter(hooks => hooks.theaterTarget);
  if (custom.length) {
    const input = { best: discovery.findBestVideo(), switchable: selectSwitchableVideos(discovery.findAllVideosDeep().filter(video => !isInactiveStandbyVideo(video))) };
    for (const hooks of custom) {
      const target = hooks.theaterTarget?.(input);
      if (target !== undefined) return target;
    }
  }
  // Manual entry only: the miniplayer stays out of discovery, Switch Video and AutoTheater.
  if (discovery.pointed && isMiniplayerTarget(discovery.pointed)) return discovery.pointed;
  return discovery.findBestVideo() ?? discovery.findAllVideosDeep().find(isMiniplayerTarget) ?? null;
}

export function providerFullscreenTarget(active: HTMLVideoElement | null, findTarget: () => HTMLElement | null): HTMLElement | null {
  if (!playbackHooks().some(hooks => hooks.fullscreenFollowsTarget) && active?.isConnected) return active;
  return findTarget();
}

export function openProviderPlaybackSession(
  element: HTMLElement,
  options: { isCurrent(): boolean; onReplacement(element: HTMLElement): void }
): ProviderPlaybackSession | null {
  for (const hooks of playbackHooks()) {
    const session = hooks.openSession?.(element, options);
    if (session) return session;
  }
  return null;
}
