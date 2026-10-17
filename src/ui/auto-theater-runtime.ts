import { DisposableScope } from '../core/disposable-scope';
import type { MediaProviderFlags } from '../media-features/provider-flags';
import { observeProviderMediaChanges } from '../providers/media-events';
import { confirmProviderPreparingVideo, confirmProviderWatchVideo, observeProviderWatchPlaybackChanges, readProviderWatchPage } from '../providers/watch-playback';
import { mediaHasSource } from '../host-play';
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
  showNotice(cancel: () => void, remainingMs: () => number, video: () => HTMLVideoElement | null): () => void;
  minNoticeMs?: number;
  skipCountdown?(): boolean;
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
  let latestVideo: HTMLVideoElement | null = null;
  let hideNotice: (() => void) | undefined;
  const intent = createAutoEnterIntent<string>({
    minVisibleMs: options.minNoticeMs ?? AUTO_ENTER_NOTICE_MIN_MS,
    show: remainingMs => { hideNotice = options.showNotice(cancelPending, remainingMs, () => latestVideo); },
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
    const previousIdentity = options.visit.current.identity;
    options.visit.current = updateAutoTheaterVisit(options.visit.current,
      page ? `${page.provider}:${page.identity}` : null);
    // The player element is often reused across videos; a new identity restarts the countdown.
    if (options.visit.current.identity !== previousIdentity) intent.cancel();
    if (!page || !options.enabled() || window !== window.top || !options.policyAllowed()
        || !options.providerFlags()[page.provider] || options.visit.current.entered) {
      intent.cancel();
      clearObservedVideo();
      return;
    }
    if (options.theaterActive()) {
      // Navigation may keep theater open on the next video. Respect a later exit
      // on that video as well as an explicitly entered theater session.
      options.visit.current.entered = true;
      intent.cancel();
      clearObservedVideo();
      return;
    }
    const video = options.findBestVideo();
    latestVideo = video;
    if (video !== observedVideo) {
      stopObserving?.();
      stopObserving = video ? page.playback.observe?.(video, refresh) ?? undefined : undefined;
      observedVideo = stopObserving ? video : null;
    }
    if (!video) {
      intent.update(null);
      return;
    }
    const eligible = video.isConnected && isSwitchableTheaterVideo(video);
    const playing = !video.paused && !video.ended && video.readyState > 2;
    const requested = !video.paused && !video.ended && !video.error;
    // The provider may recognise its content video before the host reveals, sources or sizes
    // it. That starts or keeps the countdown only; entry below still needs full eligibility.
    const confirmed = eligible && confirmProviderWatchVideo(video);
    const hostPreparing = !confirmed && requested && confirmProviderPreparingVideo(video);
    const facts = {
      enabled: options.enabled(), topLevel: window === window.top, policyAllowed: options.policyAllowed(),
      providerEnabled: options.providerFlags()[page.provider], fullscreen: Boolean(document.fullscreenElement),
      editableFocused: options.editableFocused(), theaterActive: options.theaterActive(),
      transitioning: options.transitioning(), eligibleVideo: true, playing: true,
      mainVideo: true
    };
    // Playback was requested and the stream is not failing or finished: still loading counts as
    // intent, so the countdown runs while the player buffers. Pausing or an error cancels it.
    const loading = requested && video.readyState <= 2 && (video.networkState === HTMLMediaElement.NETWORK_LOADING
      || video.networkState === HTMLMediaElement.NETWORK_IDLE
      || (hostPreparing && video.networkState === HTMLMediaElement.NETWORK_EMPTY && !mediaHasSource(video)));
    // Fullscreen and an in-flight transition are definitive; other gates may be loading blips.
    if (facts.fullscreen || facts.transitioning) intent.cancel();
    const announced = shouldAutoEnterTheater(options.visit.current, facts)
      && (confirmed || hostPreparing) && (playing || loading);
    const intended = announced && confirmed;
    if (options.skipCountdown?.()) {
      // Discard any announced entry before applying the current playback facts.
      intent.cancel();
      if (!intended || !playing) return;
    } else if (!intent.update(announced ? { key: options.visit.current.identity ?? '', ready: intended && playing } : null)) return;
    // Reserve before entry: synchronous host/UI changes cannot reenter this visit.
    options.visit.current.entered = true;
    clearObservedVideo();
    options.enter(video);
    if (!options.theaterActive()) options.visit.current.entered = false;
  };

  // Capture non-bubbling media events; no playback or discovery polling.
  for (const type of ['loadstart', 'waiting', 'play', 'error', 'abort', 'emptied', 'pause', 'ended']) {
    scope.listen(document, type, refresh, true);
  }
  scope.listen(document, 'playing', refresh, true);
  scope.listen(document, 'loadeddata', refresh, true);
  scope.listen(document, 'fullscreenchange', refresh);
  // Focus can move to another editable field; wait for activeElement to settle.
  scope.listen(document, 'focusout', () => { scope.timeout(refresh, 0); }, true);
  scope.listen(window, 'popstate', refresh);
  scope.listen(window, 'hashchange', refresh);
  scope.add(observeProviderMediaChanges(refresh));
  scope.add(observeProviderWatchPlaybackChanges(refresh));
  refresh(); // Playback may already be underway when storage hydration completes.
  return { refresh, cancelPending, dispose: () => scope.dispose() };
}
