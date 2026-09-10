export type DockRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export const CAPTION_DOCK_REST_BOTTOM = 48;
export const CAPTION_DOCK_MIN_BOTTOM = 24;
export const CAPTION_DOCK_GAP = 12;

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
