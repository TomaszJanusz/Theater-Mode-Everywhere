export type NetflixVideoFacts = {
  inPlayer: boolean;
  playing: boolean;
  visibleArea: number;
  opacity: number;
  blurred: boolean;
  usable: boolean;
};

/**
 * Prefers the modal player that is actually on screen over a blurred or
 * paused hero. A collapsed modal box is not usable, so closing it can
 * return to the visible hero.
 */
export function netflixPlaybackRank(facts: NetflixVideoFacts): number {
  if (!facts.usable) return -1;
  let rank = 0;
  if (facts.inPlayer) rank += 1000;
  if (facts.playing) rank += 200;
  if (facts.blurred || facts.opacity < 0.5) rank -= 800;
  rank += Math.min(40, Math.round(Math.max(0, facts.visibleArea) / 100000));
  return rank;
}

export function shouldFollowNetflixVideo(current: NetflixVideoFacts, candidate: NetflixVideoFacts): boolean {
  const nextRank = netflixPlaybackRank(candidate);
  if (nextRank < 0) return false;
  const currentRank = netflixPlaybackRank(current);
  if (currentRank < 0) return true;
  return nextRank >= currentRank + 50;
}

export function readNetflixVideoFacts(video: HTMLVideoElement): NetflixVideoFacts {
  const rect = video.getBoundingClientRect();
  let opacity = 1;
  let blurred = false;
  let hidden = false;
  let node: HTMLElement | null = video;
  while (node && node !== document.documentElement) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') hidden = true;
    const nodeOpacity = Number(style.opacity);
    if (Number.isFinite(nodeOpacity)) opacity *= nodeOpacity;
    if (style.filter.includes('blur')) blurred = true;
    node = node.parentElement;
  }
  const width = hidden ? 0 : Math.max(0, rect.width);
  const height = hidden ? 0 : Math.max(0, rect.height);
  return {
    inPlayer: Boolean(video.closest('.nf-player-container, [data-uia="player"]')),
    playing: !hidden && !video.paused && !video.ended && video.readyState > 2,
    visibleArea: width * height,
    opacity,
    blurred,
    usable: !hidden && width >= 80 && height >= 80 && opacity > 0.05
  };
}

export type NetflixVideoBinding = {
  bind(video: HTMLVideoElement): void;
  listeningTo(): HTMLVideoElement | null;
  dispose(): void;
};

/**
 * Follows the visible Netflix video. Style and class changes hide a modal
 * without adding or removing nodes, so childList alone misses them.
 * Listeners are dropped from the previous element when the target changes.
 */
export function createNetflixVideoBinding(options: {
  root: Node;
  current: () => HTMLVideoElement | null;
  pick: () => HTMLVideoElement | null;
  shouldSwitch: (current: HTMLVideoElement, next: HTMLVideoElement) => boolean;
  onSwitch: (next: HTMLVideoElement) => void;
  onStabilize?: (video: HTMLVideoElement) => void;
}): NetflixVideoBinding {
  let bound: HTMLVideoElement | null = null;
  let disposed = false;
  let scheduled = false;
  let videoCleanups: Array<() => void> = [];

  const clearVideo = (): void => {
    for (const cleanup of videoCleanups) cleanup();
    videoCleanups = [];
  };

  const bind = (video: HTMLVideoElement): void => {
    if (disposed) return;
    clearVideo();
    bound = video;
    const onMeta = (): void => {
      if (bound === video) options.onStabilize?.(video);
    };
    video.addEventListener('loadedmetadata', onMeta);
    videoCleanups.push(() => video.removeEventListener('loadedmetadata', onMeta));
    const styleObserver = new MutationObserver(() => {
      if (bound === video) options.onStabilize?.(video);
    });
    styleObserver.observe(video, { attributes: true, attributeFilter: ['style'] });
    videoCleanups.push(() => styleObserver.disconnect());
  };

  const follow = (): void => {
    const active = options.current();
    if (!active || !active.isConnected) return;
    const next = options.pick();
    if (!next || next === active || !next.isConnected) return;
    if (!options.shouldSwitch(active, next)) return;
    options.onSwitch(next);
    if (options.current() === next) bind(next);
  };

  const observer = new MutationObserver(() => {
    if (scheduled || disposed) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (!disposed) follow();
    });
  });
  observer.observe(options.root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden']
  });

  return {
    bind,
    listeningTo: () => bound,
    dispose() {
      disposed = true;
      observer.disconnect();
      clearVideo();
      bound = null;
    }
  };
}
