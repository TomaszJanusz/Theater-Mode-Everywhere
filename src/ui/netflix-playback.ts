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
  const style = getComputedStyle(video);
  const opacity = Number(style.opacity);
  const width = Math.max(0, rect.width);
  const height = Math.max(0, rect.height);
  return {
    inPlayer: Boolean(video.closest('.nf-player-container, [data-uia="player"]')),
    playing: !video.paused && !video.ended && video.readyState > 2,
    visibleArea: width * height,
    opacity: Number.isFinite(opacity) ? opacity : 1,
    blurred: style.filter.includes('blur'),
    usable: width >= 80 && height >= 80 && opacity > 0.05
  };
}
