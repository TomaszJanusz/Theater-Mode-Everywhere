import { AUDIO_SETTINGS_EVENT, isNeutralAudio, readAudioDataset, sameAudioSettings, type AudioSettings } from '../audio-settings';
import { findActiveVideo } from './active-video';
import { createAudioChain, type AudioChain } from './audio-graph';
import { mediaAudioAccess } from './media-audio-access';

type MediaAudioGraph = { context: AudioContext; chain: AudioChain; gain: GainNode; settings: AudioSettings; boost: number };

/** One graph per media element, shared by gain and all audio effects. */
export function installMediaAudioRuntime(): void {
  // A MediaElementSource cannot be recreated for the same element. Retain
  // its graph across theater exit/reentry and bypass effects when neutral.
  const graphs = new WeakMap<HTMLVideoElement, MediaAudioGraph>();
  const failedVideos = new WeakSet<HTMLVideoElement>();
  let metadata: { video: HTMLVideoElement; cancel(): void } | null = null;

  function clearMetadata(video?: HTMLVideoElement): void {
    if (video && metadata?.video !== video) return;
    metadata?.cancel();
    metadata = null;
  }

  function resume(context: AudioContext): void {
    if (context.state === 'suspended') void context.resume().catch(console.error);
  }

  function multiplier(video: HTMLVideoElement): number {
    const value = Number(video.dataset.theaterBoost ?? 1);
    return Number.isFinite(value) && value >= 1 ? value : 1;
  }

  function waitForMetadata(video: HTMLVideoElement): void {
    clearMetadata();
    const source = video.currentSrc || video.src;
    const ready = () => {
      if (metadata !== pending) return;
      clearMetadata();
      if (findActiveVideo(document) !== video || (video.currentSrc || video.src) !== source) return;
      sync(video);
    };
    const pending = { video, cancel: () => video.removeEventListener('loadedmetadata', ready) };
    video.addEventListener('loadedmetadata', ready, { once: true });
    metadata = pending;
  }

  function sync(video: HTMLVideoElement, userGesture = false): void {
    clearMetadata(video);
    const settings = readAudioDataset(video.dataset);
    const boost = multiplier(video);
    const existing = graphs.get(video);
    if (existing) {
      if (!sameAudioSettings(existing.settings, settings)) {
        existing.chain.apply(settings);
        existing.settings = settings;
      }
      if (existing.boost !== boost) {
        existing.gain.gain.value = boost;
        existing.boost = boost;
      }
      resume(existing.context);
      return;
    }
    // Reset events from an old player may update its existing graph, but
    // must never create a new graph or retain a pending activation.
    if (isNeutralAudio(settings) && boost === 1) return;
    if (failedVideos.has(video) || findActiveVideo(document) !== video) return;
    clearMetadata();
    if (mediaAudioAccess(video, window.location.origin) !== 'open' || !(userGesture || navigator.userActivation?.isActive)) {
      if (video.readyState === 0) waitForMetadata(video);
      return;
    }

    let context: AudioContext | null = null;
    try {
      const AudioCtx = window.AudioContext
        || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      context = new AudioCtx();
      const chain = createAudioChain(context);
      const gain = context.createGain();
      chain.apply(settings);
      gain.gain.value = boost;
      chain.output.connect(gain).connect(context.destination);
      context.createMediaElementSource(video).connect(chain.input);
      graphs.set(video, { context, chain, gain, settings, boost });
      video.dataset.theaterBoostReady = 'true';
      window.dispatchEvent(new CustomEvent('theater-everywhere-boost-ready'));
      resume(context);
    } catch (error) {
      failedVideos.add(video);
      if (context) void context.close().catch(console.error);
      console.error('[Theater Everywhere Main World] Web Audio setup failed:', error);
    }
  }

  function syncActive(userGesture = false): void {
    const video = findActiveVideo(document);
    if (video) sync(video, userGesture);
    else clearMetadata();
  }

  window.addEventListener('theater-everywhere-boost-event', () => syncActive());
  window.addEventListener(AUDIO_SETTINGS_EVENT, (event: Event) => {
    const video = event.composedPath()[0];
    if (video instanceof HTMLVideoElement) sync(video);
  }, true);
  // Both controls and shortcuts can supply activation for the first graph.
  // Reading current attributes also rejects work left by a replaced player.
  for (const event of ['click', 'keydown', 'pointerdown'] as const) {
    window.addEventListener(event, gesture => syncActive(gesture.isTrusted), { capture: true, passive: true });
  }
  window.addEventListener('input', event => {
    if (event.target instanceof HTMLElement && event.target.classList.contains('theater-volume-slider')) syncActive(event.isTrusted);
  }, { capture: true, passive: true });
}
