import { DisposableScope } from '../core/disposable-scope';
import type { MediaProviderFlags } from '../media-features/provider-flags';
import { observeProviderMediaChanges } from '../providers/media-events';
import { confirmProviderWatchVideo, readProviderWatchPage } from '../providers/watch-playback';
import { isSwitchableTheaterVideo } from '../switchable-videos';
import { AUTO_ENTER_NOTICE_MIN_MS, createAutoEnterIntent } from './auto-theater-intent';
import { shouldAutoEnterTheater, updateAutoTheaterVisit, type AutoTheaterVisit } from './auto-theater';

export type AutoTheaterRuntime = {
  refresh(): void;
  /** Cancels an announced entry for this visit. Returns whether one was pending. */
  cancelPending(): boolean;
  dispose(): void;
};

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
  /** Shows the entry notice and returns its cleanup. */
  showNotice(cancel: () => void): () => void;
  minNoticeMs?: number;
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
  let hideNotice: (() => void) | undefined;
  const intent = createAutoEnterIntent<HTMLVideoElement>({
    minVisibleMs: options.minNoticeMs ?? AUTO_ENTER_NOTICE_MIN_MS,
    show: () => { hideNotice = options.showNotice(cancelPending); },
    hide: () => { hideNotice?.(); hideNotice = undefined; },
    recheck: () => refresh()
  });
  scope.add(() => intent.dispose());
  // Cancelling consumes the visit, so the same media never announces again; a new
  // content identity resets it and manual entry is unaffected.
  function cancelPending(): boolean {
    const wasPending = intent.cancel();
    if (wasPending) options.visit.current.entered = true;
    return wasPending;
  }

  const refresh = (): void => {
    if (scope.isDisposed) return;
    const page = readProviderWatchPage(new URL(window.location.href));
    options.visit.current = updateAutoTheaterVisit(options.visit.current,
      page ? `${page.provider}:${page.identity}` : null);
    if (!page || !options.enabled() || window !== window.top || !options.policyAllowed()
        || !options.providerFlags()[page.provider] || options.visit.current.entered) {
      intent.update(null);
      clearObservedVideo();
      return;
    }
    if (options.theaterActive()) {
      // Navigation may keep theater open on the next video. Respect a later exit
      // on that video as well as an explicitly entered theater session.
      options.visit.current.entered = true;
      intent.update(null);
      clearObservedVideo();
      return;
    }
    const video = options.findBestVideo();
    if (video !== observedVideo) {
      stopObserving?.();
      observedVideo = video;
      stopObserving = video ? page.playback.observe?.(video, refresh) : undefined;
    }
    if (!video) {
      intent.update(null);
      return;
    }
    const eligible = video.isConnected && isSwitchableTheaterVideo(video);
    const playing = !video.paused && !video.ended && video.readyState > 2;
    const facts = {
      enabled: options.enabled(), topLevel: window === window.top, policyAllowed: options.policyAllowed(),
      providerEnabled: options.providerFlags()[page.provider], fullscreen: Boolean(document.fullscreenElement),
      editableFocused: options.editableFocused(), theaterActive: options.theaterActive(),
      transitioning: options.transitioning(), eligibleVideo: eligible, playing,
      mainVideo: true
    };
    // A player that was asked to play but is still loading its stream already counts as intent.
    const loading = !video.paused && !video.ended && !playing;
    const intended = (playing || loading) && shouldAutoEnterTheater(options.visit.current, { ...facts, playing: true })
      && confirmProviderWatchVideo(video);
    if (!intent.update(intended ? { key: video, ready: playing } : null)) return;
    // Reserve before entry: synchronous host/UI changes cannot reenter this visit.
    options.visit.current.entered = true;
    clearObservedVideo();
    options.enter(video);
    if (!options.theaterActive()) options.visit.current.entered = false;
  };

  // Capture non-bubbling media events; no playback or discovery polling.
  scope.listen(document, 'play', refresh, true);
  scope.listen(document, 'playing', refresh, true);
  scope.listen(document, 'loadeddata', refresh, true);
  scope.listen(window, 'popstate', refresh);
  scope.listen(window, 'hashchange', refresh);
  scope.add(observeProviderMediaChanges(refresh));
  refresh(); // Playback may already be underway when storage hydration completes.
  return { refresh, cancelPending, dispose: () => scope.dispose() };
}
