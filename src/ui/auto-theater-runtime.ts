import { DisposableScope } from '../core/disposable-scope';
import { mediaHasSource } from '../host-play';
import type { MediaProviderFlags, MediaProviderId } from '../media-features/provider-flags';
import { observeProviderMediaChanges } from '../providers/media-events';
import { confirmProviderPreparingVideo, confirmProviderWatchVideo, observeProviderWatchPlaybackChanges, readProviderWatchPage } from '../providers/watch-playback';
import { isSwitchableTheaterVideo } from '../switchable-videos';

import { shouldAutoEnterTheater, updateAutoTheaterVisit, type AutoTheaterVisit } from './auto-theater';
import { AUTO_ENTER_NOTICE_MIN_MS, createAutoEnterIntent } from './auto-theater-intent';

/**
 * The notice waits this long after the countdown starts. Hosts often do heavy main-thread work
 * right then (ad-to-content swaps, SPA navigation), and a notice first painted in such a stalled
 * frame shows up half-drawn. Material that is skipped or replaced within this window never gets one.
 * The countdown itself is unaffected: the notice joins it where the intent's clock says it is.
 */
export const AUTO_ENTER_NOTICE_DELAY_MS = 250;

export type AutoTheaterRuntime = {
  refresh(): void;
  /** Cancels an announced entry for this visit. Returns whether one was pending. */
  cancelPending(): boolean;
  dispose(): void;
};

/** One visit survives preference/blacklist toggles and runtime scope recreation. */
export function createAutoTheaterRuntime(options: {
  visit: { current: AutoTheaterVisit };
  enabled(provider: MediaProviderId): boolean;
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
  /** Defaults to `AUTO_ENTER_NOTICE_DELAY_MS`; 0 shows synchronously. */
  noticeDelayMs?: number;
  skipCountdown?(): boolean;
}): AutoTheaterRuntime {
  const scope = new DisposableScope();
  let observedVideo: HTMLVideoElement | null = null;
  let stopObserving: (() => void) | undefined;
  let stopReveal: (() => void) | undefined;
  const clearObservedVideo = (): void => {
    stopObserving?.();
    stopObserving = undefined;
    stopReveal?.();
    stopReveal = undefined;
    observedVideo = null;
  };
  scope.add(clearObservedVideo);
  let latestVideo: HTMLVideoElement | null = null;
  let hideNotice: (() => void) | undefined;
  let showTimer: ReturnType<typeof setTimeout> | undefined;
  const noticeDelayMs = options.noticeDelayMs ?? AUTO_ENTER_NOTICE_DELAY_MS;
  const intent = createAutoEnterIntent<string>({
    minVisibleMs: options.minNoticeMs ?? AUTO_ENTER_NOTICE_MIN_MS,
    show: remainingMs => {
      const mount = (): void => {
        showTimer = undefined;
        hideNotice = options.showNotice(cancelPending, remainingMs, () => latestVideo);
      };
      // The intent hides before showing again, so at most one mount is ever scheduled.
      if (noticeDelayMs > 0) showTimer = scope.timeout(mount, noticeDelayMs);
      else mount();
    },
    hide: () => {
      clearTimeout(showTimer);
      showTimer = undefined;
      hideNotice?.();
      hideNotice = undefined;
    },
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
    // A disabled service consumes this visit: enabling it waits for the next identity, never mid-watch.
    if (page && !options.enabled(page.provider)) options.visit.current.entered = true;
    if (!page || !options.enabled(page.provider) || window !== window.top || !options.policyAllowed()
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
    // Attached before the video lookup: the player may still sit in the miniplayer, where it is no candidate.
    stopReveal ??= page.playback.observeReveal?.(document, refresh);
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
      enabled: options.enabled(page.provider), topLevel: window === window.top, policyAllowed: options.policyAllowed(),
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
