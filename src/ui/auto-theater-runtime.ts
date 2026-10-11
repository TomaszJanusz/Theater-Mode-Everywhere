import { DisposableScope } from '../core/disposable-scope';
import type { MediaProviderFlags } from '../media-features/provider-flags';
import { observeProviderMediaChanges } from '../providers/media-events';
import { confirmProviderWatchVideo, readProviderWatchPage } from '../providers/watch-playback';
import { isSwitchableTheaterVideo } from '../switchable-videos';
import { shouldAutoEnterTheater, updateAutoTheaterVisit, type AutoTheaterVisit } from './auto-theater';

export type AutoTheaterRuntime = { refresh(): void; dispose(): void };

/** One visit survives preference/blacklist toggles and runtime scope recreation. */
export function createAutoTheaterRuntime(options: {
  visit: { current: AutoTheaterVisit };
  enabled(): boolean;
  policyAllowed(): boolean;
  providerFlags(): MediaProviderFlags;
  editableFocused(): boolean;
  theaterActive(): boolean;
  transitioning(): boolean;
  findBestVideo(): HTMLVideoElement | null;
  enter(video: HTMLVideoElement): void;
}): AutoTheaterRuntime {
  const scope = new DisposableScope();
  let observedVideo: HTMLVideoElement | null = null;
  let stopObserving: (() => void) | undefined;
  const clearObservedVideo = (): void => {
    stopObserving?.();
    stopObserving = undefined;
    observedVideo = null;
  };
  scope.add(clearObservedVideo);

  const refresh = (): void => {
    if (scope.isDisposed) return;
    const page = readProviderWatchPage(new URL(window.location.href));
    options.visit.current = updateAutoTheaterVisit(options.visit.current,
      page ? `${page.provider}:${page.identity}` : null);
    if (!page || !options.enabled() || window !== window.top || !options.policyAllowed()
        || !options.providerFlags()[page.provider] || options.visit.current.entered) {
      clearObservedVideo();
      return;
    }
    if (options.theaterActive()) {
      // Navigation may keep theater open on the next video. Respect a later exit
      // on that video as well as an explicitly entered theater session.
      options.visit.current.entered = true;
      clearObservedVideo();
      return;
    }
    const video = options.findBestVideo();
    if (video !== observedVideo) {
      stopObserving?.();
      observedVideo = video;
      stopObserving = video ? page.playback.observe?.(video, refresh) : undefined;
    }
    if (!video) return;
    const eligible = video.isConnected && isSwitchableTheaterVideo(video);
    const playing = !video.paused && !video.ended && video.readyState > 2;
    if (!shouldAutoEnterTheater(options.visit.current, {
      enabled: options.enabled(), topLevel: window === window.top, policyAllowed: options.policyAllowed(),
      providerEnabled: options.providerFlags()[page.provider], fullscreen: Boolean(document.fullscreenElement),
      editableFocused: options.editableFocused(), theaterActive: options.theaterActive(),
      transitioning: options.transitioning(), eligibleVideo: eligible, playing,
      mainVideo: true
    }) || !confirmProviderWatchVideo(video)) return;
    // Reserve before entry: synchronous host/UI changes cannot reenter this visit.
    options.visit.current.entered = true;
    clearObservedVideo();
    options.enter(video);
    if (!options.theaterActive()) options.visit.current.entered = false;
  };

  // Capture non-bubbling media events; no playback or discovery polling.
  scope.listen(document, 'playing', refresh, true);
  scope.listen(document, 'loadeddata', refresh, true);
  scope.listen(window, 'popstate', refresh);
  scope.listen(window, 'hashchange', refresh);
  scope.add(observeProviderMediaChanges(refresh));
  refresh(); // Playback may already be underway when storage hydration completes.
  return { refresh, dispose: () => scope.dispose() };
}
