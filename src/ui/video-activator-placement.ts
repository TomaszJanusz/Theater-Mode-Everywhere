/**
 * Pure rules for the video activator: which videos qualify and which position is free.
 * Geometry and occlusion arrive as plain data or an injected probe, so nothing here
 * touches the DOM.
 */
export type Box = { left: number; top: number; width: number; height: number };
export type Viewport = { width: number; height: number };
export type ActivatorSpot = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';

export const ACTIVATOR_SIZE = 40;
export const ACTIVATOR_MARGIN = 12;
/** Below this a video is an ad slot, thumbnail or decoration rather than a player. */
export const ACTIVATOR_MIN_WIDTH = 240;
export const ACTIVATOR_MIN_HEIGHT = 135;

/** Hosts keep titles and share buttons on the left and controls at the bottom; the right corner is usually quietest. */
const SPOT_ORDER: readonly ActivatorSpot[] = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'top-center', 'bottom-center'];

export type ActivatorVideoFacts = {
  width: number;
  height: number;
  visible: boolean;
  /** Playable media: a source and metadata, and not a host's auxiliary or standby player. */
  playable: boolean;
  muted: boolean;
  loop: boolean;
  inExtensionUi: boolean;
  pictureInPicture: boolean;
};

/** Muted looping video is a hover preview or background, not something to watch in theater. */
export function isActivatorVideoEligible(facts: ActivatorVideoFacts): boolean {
  return facts.visible && facts.playable && !facts.inExtensionUi && !facts.pictureInPicture
    && facts.width >= ACTIVATOR_MIN_WIDTH && facts.height >= ACTIVATOR_MIN_HEIGHT
    && !(facts.muted && facts.loop);
}

export function spotBox(video: Box, spot: ActivatorSpot, size = ACTIVATOR_SIZE, margin = ACTIVATOR_MARGIN): Box {
  if (spot.endsWith('center')) {
    // Centre the button at one-third / two-thirds of the video height.
    return {
      left: video.left + (video.width - size) / 2,
      top: video.top + video.height * (spot === 'top-center' ? 1 / 3 : 2 / 3) - size / 2,
      width: size, height: size
    };
  }
  const left = spot.endsWith('left') ? video.left + margin : video.left + video.width - margin - size;
  const top = spot.startsWith('top') ? video.top + margin : video.top + video.height - margin - size;
  return { left, top, width: size, height: size };
}

/** A 3x3 grid over the box, so a bar that has gaps between its buttons still registers. */
export function samplePoints(box: Box): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (const fy of [0.1, 0.5, 0.9]) {
    for (const fx of [0.1, 0.5, 0.9]) points.push([box.left + box.width * fx, box.top + box.height * fy]);
  }
  return points;
}

function within(box: Box, viewport: Viewport): boolean {
  return box.left >= 0 && box.top >= 0 && box.left + box.width <= viewport.width && box.top + box.height <= viewport.height;
}

export type SpotChoice = { spot: ActivatorSpot; box: Box };

/**
 * First candidate that is fully on screen and whose sample points are all free.
 * The previous spot is tried first so the button stays where the viewer last saw it.
 * `bottomBlocked` drops both bottom corners and the lower centre slot for native
 * controls, which are drawn by the browser and invisible to hit testing.
 */
export function chooseActivatorSpot(
  video: Box,
  viewport: Viewport,
  isFree: (x: number, y: number) => boolean,
  options: { preferred?: ActivatorSpot | null; bottomBlocked?: boolean } = {}
): SpotChoice | null {
  const order = options.preferred ? [options.preferred, ...SPOT_ORDER.filter(spot => spot !== options.preferred)] : SPOT_ORDER;
  for (const spot of order) {
    if (options.bottomBlocked && spot.startsWith('bottom')) continue;
    const box = spotBox(video, spot);
    if (within(box, viewport) && samplePoints(box).every(([x, y]) => isFree(x, y))) return { spot, box };
  }
  return null;
}

/** A short approach lead on small players without reaching distant page UI on large ones. */
export const ACTIVATOR_PROXIMITY = { ratio: 0.1, min: 24, max: 80 } as const;

export function activatorZoneMargin(box: Box): number {
  return Math.max(ACTIVATOR_PROXIMITY.min,
    Math.min(ACTIVATOR_PROXIMITY.max, Math.min(box.width, box.height) * ACTIVATOR_PROXIMITY.ratio));
}

/** Distance to the rectangle (zero inside), rather than its centre: edges are equally approachable. */
export function activatorDistanceSquared(box: Box, x: number, y: number): number {
  const dx = Math.max(box.left - x, 0, x - box.left - box.width);
  const dy = Math.max(box.top - y, 0, y - box.top - box.height);
  return dx * dx + dy * dy;
}

export function isInActivatorZone(box: Box, x: number, y: number): boolean {
  const margin = activatorZoneMargin(box);
  return x >= box.left - margin && x <= box.left + box.width + margin
    && y >= box.top - margin && y <= box.top + box.height + margin;
}

/** Stable input order breaks ties, including overlapping videos; one linear pass, no sorting. */
export function nearestActivatorVideo<T extends { box: Box }>(videos: Iterable<T>, x: number, y: number): T | null {
  let nearest: T | null = null;
  let distance = Infinity;
  for (const video of videos) {
    if (!isInActivatorZone(video.box, x, y)) continue;
    const next = activatorDistanceSquared(video.box, x, y);
    if (next < distance) { nearest = video; distance = next; }
  }
  return nearest;
}
