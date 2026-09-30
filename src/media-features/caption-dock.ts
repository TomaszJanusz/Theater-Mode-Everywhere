export type DockRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export const CAPTION_DOCK_REST_BOTTOM = 48;
export const CAPTION_DOCK_MIN_BOTTOM = 24;
export const CAPTION_DOCK_GAP = 12;
/** Closest a raised caption block sits to the screen edge. */
export const CAPTION_DOCK_RAISED_EDGE = 8;
/**
 * 16:9 on 16:10 leaves a band of exactly 1/10 the frame.
 * Bands up to this fraction stay snug under the picture; the extra 0.005 absorbs a pixel of measurement noise.
 */
export const CAPTION_DOCK_SNUG_BAND_RATIO = 0.105;
/** Deepest air kept between the picture and a block centered in a taller letterbox. */
export const CAPTION_DOCK_RAISED_CENTER_GAP = 48;
export const CAPTION_LINE_LIMIT_MIN = 2;
export const CAPTION_LINE_LIMIT_MAX = 3;

/**
 * A 16:10-sized band keeps the block snug under the picture.
 * A deeper band centers it in the black, and never more than `centerGap` below the picture.
 * Without a frame height the block stays snug, which is the previous resting rule.
 */
export function raisedCaptionRestBottom(
  bandHeight: number,
  captionHeight: number,
  viewportHeight = 0,
  edge = CAPTION_DOCK_RAISED_EDGE,
  centerGap = CAPTION_DOCK_RAISED_CENTER_GAP
): number {
  if (!(bandHeight > 0) || !(captionHeight > 0)) return edge;
  const snug = Math.max(edge, Math.round(bandHeight - captionHeight));
  if (!(viewportHeight > 0) || bandHeight / viewportHeight <= CAPTION_DOCK_SNUG_BAND_RATIO) return snug;
  const slack = bandHeight - captionHeight;
  if (!(slack > 0)) return edge;
  const gap = Math.min(slack / 2, centerGap);
  return Math.max(edge, Math.round(slack - gap));
}

/** How many caption rows fit in the letterbox, clamped to two or three. */
export function raisedCaptionLineLimit(
  bandHeight: number,
  lineHeight: number,
  edge = CAPTION_DOCK_RAISED_EDGE
): number {
  if (!(bandHeight > 0) || !(lineHeight > 0)) return CAPTION_LINE_LIMIT_MIN;
  const fitted = Math.floor((bandHeight - edge) / lineHeight);
  return Math.min(CAPTION_LINE_LIMIT_MAX, Math.max(CAPTION_LINE_LIMIT_MIN, fitted));
}

export function centeredCaptionRect(
  width: number,
  height: number,
  bottomOffset: number,
  viewportWidth: number,
  viewportHeight: number
): DockRect {
  const left = (viewportWidth - width) / 2;
  const bottom = viewportHeight - bottomOffset;
  return {
    left,
    right: left + width,
    top: bottom - height,
    bottom
  };
}

export function rectsOverlap(a: DockRect, b: DockRect, padding = 0): boolean {
  return a.left < b.right + padding &&
    a.right > b.left - padding &&
    a.top < b.bottom + padding &&
    a.bottom > b.top - padding;
}

export function computeCaptionDockBottom(input: {
  captionSize: { width: number; height: number } | null;
  obstacles: DockRect[];
  viewportWidth: number;
  viewportHeight: number;
  restBottom?: number;
  minBottom?: number;
  gap?: number;
}): number {
  const restBottom = input.restBottom ?? CAPTION_DOCK_REST_BOTTOM;
  const minBottom = input.minBottom ?? CAPTION_DOCK_MIN_BOTTOM;
  const gap = input.gap ?? CAPTION_DOCK_GAP;
  const { viewportWidth: vw, viewportHeight: vh } = input;

  if (!input.captionSize || input.captionSize.width < 1 || input.captionSize.height < 1) {
    return restBottom;
  }

  let bottom = restBottom;
  for (let i = 0; i < 4; i++) {
    const caption = centeredCaptionRect(
      input.captionSize.width,
      input.captionSize.height,
      bottom,
      vw,
      vh
    );
    let highestTop = vh;
    let hit = false;
    for (const obstacle of input.obstacles) {
      if (!rectsOverlap(caption, obstacle)) continue;
      hit = true;
      if (obstacle.top < highestTop) highestTop = obstacle.top;
    }
    if (!hit) break;
    const next = Math.max(minBottom, Math.round(vh - highestTop + gap));
    if (next <= bottom) break;
    bottom = next;
  }
  return bottom;
}
