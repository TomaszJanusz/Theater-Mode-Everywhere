import { AUDIO_SETTINGS_EVENT, isNeutralAudio, readAudioDataset, sameAudioSettings, type AudioSettings } from '../audio-settings';
import { findActiveVideo, THEATER_VIDEO_SELECTOR } from './active-video';
import { createAudioChain, type AudioChain } from './audio-graph';
import { mediaAudioAccess } from './media-audio-access';

const PLAYBACK_EVENTS = ['playing', 'pause', 'ended', 'emptied'] as const;

type MediaAudioGraph = {
  video: HTMLVideoElement;
  context: AudioContext;
  chain: AudioChain;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  settings: AudioSettings;
  boost: number;
  disposed: boolean;
  operation: Promise<void> | null;
  playbackChanged(): void;
};

/** One graph per connected media element, shared by gain and all audio effects. */
export function installMediaAudioRuntime(): void {
  // A MediaElementSource cannot be recreated for the same element. Retain
  // its context across theater exit/reentry, but retire detached players.
  const graphs = new Map<HTMLVideoElement, MediaAudioGraph>();
  const retiredVideos = new WeakSet<HTMLVideoElement>();
  // Neutral media needs no removal observer; do not retain it through the cache.
  let activeVideo: WeakRef<HTMLVideoElement> | null = null;
  let metadata: { video: HTMLVideoElement; cancel(): void } | null = null;
  let observedRoots = new Set<Document | ShadowRoot>();
  const removals = new MutationObserver(records => {
    if (!records.some(record => record.removedNodes.length > 0)) return;
    for (const graph of graphs.values()) if (!inDocument(graph.video)) retire(graph);
    refreshObservation();
  });

  function inDocument(video: HTMLVideoElement): boolean {
    return video.isConnected && video.ownerDocument === document;
  }

  function refreshObservation(): void {
    const roots = new Set<Document | ShadowRoot>();
    for (const video of graphs.keys()) {
      roots.add(document);
      let root = video.getRootNode();
      while (root instanceof ShadowRoot) {
        roots.add(root);
        root = root.host.getRootNode();
      }
    }
    if (roots.size === observedRoots.size && [...roots].every(root => observedRoots.has(root))) return;
    removals.disconnect();
    for (const root of roots) removals.observe(root, { childList: true, subtree: true });
    observedRoots = roots;
  }

  function clearMetadata(video?: HTMLVideoElement): void {
    if (video && metadata?.video !== video) return;
    metadata?.cancel();
    metadata = null;
  }

  function retire(graph: MediaAudioGraph): void {
    if (graph.disposed) return;
    graph.disposed = true;
    const { video, context } = graph;
    graphs.delete(video);
    // Closing releases the element, but it still cannot acquire another source.
    retiredVideos.add(video);
    clearMetadata(video);
    if (activeVideo?.deref() === video) activeVideo = null;
    for (const event of PLAYBACK_EVENTS) video.removeEventListener(event, graph.playbackChanged);
    context.removeEventListener('statechange', graph.playbackChanged);
    graph.chain.dispose();
    graph.source.disconnect();
    graph.gain.disconnect();
    delete video.dataset.theaterBoostReady;
    if (context.state !== 'closed') void context.close().catch(console.error);
  }

  function reconcilePlayback(graph: MediaAudioGraph): void {
    if (graph.disposed || graph.operation) return;
    if (!inDocument(graph.video)) { retire(graph); refreshObservation(); return; }
    const { context, video } = graph;
    const playing = !video.paused && !video.ended;
    if (context.state === 'closed' || (playing ? context.state !== 'suspended' : context.state !== 'running')) return;
    const operation = playing ? context.resume() : context.suspend();
    graph.operation = operation;
    void operation.then(() => {
      graph.operation = null;
      // A pause or replacement can arrive while resume is pending, and vice versa.
      if (!graph.disposed) reconcilePlayback(graph);
    }, error => {
      graph.operation = null;
      if (!graph.disposed) console.error('[Theater Everywhere Main World] Web Audio state failed:', error);
    });
  }

  function currentVideo(): HTMLVideoElement | null {
    // This marker exists in the media document, including a theater iframe.
    // Ordinary page input must not enumerate its DOM or any shadow trees.
    if (!document.documentElement.classList.contains('theater-everywhere-html-active')) {
      activeVideo = null;
      return null;
    }
    const cached = activeVideo?.deref();
    if (cached && inDocument(cached) && cached.matches(THEATER_VIDEO_SELECTOR)) return cached;
    const video = findActiveVideo(document);
    activeVideo = video ? new WeakRef(video) : null;
    return video;
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
      if (currentVideo() !== video || (video.currentSrc || video.src) !== source) return;
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
      if (!inDocument(video)) { retire(existing); refreshObservation(); return; }
      if (!sameAudioSettings(existing.settings, settings)) {
        existing.chain.apply(settings);
        existing.settings = settings;
      }
      if (existing.boost !== boost) {
        existing.gain.gain.value = boost;
        existing.boost = boost;
      }
      reconcilePlayback(existing);
      return;
    }
    // Reset events from an old player may update its existing graph, but
    // must never create a new graph or retain a pending activation.
    if (isNeutralAudio(settings) && boost === 1) return;
    if (retiredVideos.has(video) || currentVideo() !== video) return;
    clearMetadata();
    if (mediaAudioAccess(video, window.location.origin) !== 'open' || !(userGesture || navigator.userActivation?.isActive)) {
      if (video.readyState === 0) waitForMetadata(video);
      return;
    }

    let context: AudioContext | null = null;
    let chain: AudioChain | null = null;
    try {
      const AudioCtx = window.AudioContext
        || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      context = new AudioCtx();
      chain = createAudioChain(context);
      const gain = context.createGain();
      chain.apply(settings);
      gain.gain.value = boost;
      chain.output.connect(gain).connect(context.destination);
      const source = context.createMediaElementSource(video);
      source.connect(chain.input);
      const graph: MediaAudioGraph = {
        video, context, chain, source, gain, settings, boost, disposed: false, operation: null,
        playbackChanged: () => reconcilePlayback(graph)
      };
      graphs.set(video, graph);
      for (const event of PLAYBACK_EVENTS) video.addEventListener(event, graph.playbackChanged);
      // Browsers can auto-resume a context on a gesture even when media is paused.
      context.addEventListener('statechange', graph.playbackChanged);
      refreshObservation();
      video.dataset.theaterBoostReady = 'true';
      window.dispatchEvent(new CustomEvent('theater-everywhere-boost-ready'));
      reconcilePlayback(graph);
    } catch (error) {
      retiredVideos.add(video);
      chain?.dispose();
      if (context) void context.close().catch(console.error);
      console.error('[Theater Everywhere Main World] Web Audio setup failed:', error);
    }
  }

  function syncActive(userGesture = false): void {
    const video = currentVideo();
    if (video) sync(video, userGesture);
    else clearMetadata();
  }

  window.addEventListener('theater-everywhere-boost-event', () => syncActive());
  window.addEventListener(AUDIO_SETTINGS_EVENT, (event: Event) => {
    const video = event.composedPath()[0];
    if (video instanceof HTMLVideoElement) sync(video);
  }, true);
  // Both controls and shortcuts can supply activation for the first graph.
  for (const event of ['click', 'keydown', 'pointerdown'] as const) {
    window.addEventListener(event, gesture => syncActive(gesture.isTrusted), { capture: true, passive: true });
  }
  window.addEventListener('input', event => {
    if (event.target instanceof HTMLElement && event.target.classList.contains('theater-volume-slider')) syncActive(event.isTrusted);
  }, { capture: true, passive: true });
}
