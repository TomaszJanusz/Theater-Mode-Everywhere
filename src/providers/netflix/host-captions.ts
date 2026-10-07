import { DisposableScope } from '../../core/disposable-scope';
import type { HostCaptionLayout } from '../../media-features/types';

/** Native cue replacement must redock before the browser paints its new rows. */
export function observeNetflixCaptionDock(scope: DisposableScope, root: HTMLElement, update: () => void): void {
  const isCaption = (node: Node): boolean => {
    const element = node instanceof Element ? node : node.parentElement;
    return Boolean(element?.closest('.player-timedtext') || element?.querySelector('.player-timedtext'));
  };
  const observer = new MutationObserver(records => {
    if (records.some(record => isCaption(record.target)
      || [...record.addedNodes, ...record.removedNodes].some(isCaption))) update();
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  scope.add(() => observer.disconnect());
}

/** Vertical padding of a Netflix cue span (`padding: 8px 16px`). */
const NETFLIX_CUE_PADDING_Y = 16;

export type NetflixSpanBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  lineHeight: number;
};

export type NetflixCaptionBox = {
  width: number;
  height: number;
  lineHeight: number;
  rows: number;
};

/**
 * One painted Netflix line, from the cue spans inside a single text container.
 * Span positions are only used to union words on that line. The container's
 * absolute top is not part of the box, so a dock move cannot change the height.
 */
function netflixCueLine(spans: readonly NetflixSpanBox[]): { width: number; height: number; lineHeight: number; rows: number } | null {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  let lineHeight = 0;
  for (const span of spans) {
    if (!(span.width > 1) || !(span.height > 1)) continue;
    left = Math.min(left, span.left);
    right = Math.max(right, span.left + span.width);
    top = Math.min(top, span.top);
    bottom = Math.max(bottom, span.top + span.height);
    if (span.lineHeight > lineHeight) lineHeight = span.lineHeight;
  }
  const width = Math.round(right - left);
  const height = Math.round(bottom - top);
  if (!(width > 1) || !(height > 1)) return null;
  const contentHeight = Math.max(0, height - NETFLIX_CUE_PADDING_Y);
  const rows = lineHeight > 0 ? Math.max(1, Math.round(contentHeight / lineHeight)) : 1;
  return { width, height, lineHeight, rows };
}

/** Painted cue text. Line boxes stack; the gap between native cue positions does not. */
export function netflixPaintedCaptionBox(containers: readonly (readonly NetflixSpanBox[])[]): NetflixCaptionBox | null {
  let width = 0;
  let height = 0;
  let lineHeight = 0;
  let rows = 0;
  let painted = false;
  for (const spans of containers) {
    const line = netflixCueLine(spans);
    if (!line) continue;
    painted = true;
    width = Math.max(width, line.width);
    height += line.height;
    if (line.lineHeight > lineHeight) lineHeight = line.lineHeight;
    rows += line.rows;
  }
  if (!painted || width <= 1 || height <= 1) return null;
  return { width, height, lineHeight, rows: Math.max(1, rows) };
}

/** Keep the last painted cue while Netflix clears the renderer between lines. */
export function nextNetflixCaptionBox(
  previous: NetflixCaptionBox | null,
  painted: NetflixCaptionBox | null,
  hostPresent: boolean
): NetflixCaptionBox | null {
  if (!hostPresent) return null;
  return painted ?? previous;
}

function readNetflixPaintedCaption(host: HTMLElement): NetflixCaptionBox | null {
  const groups: NetflixSpanBox[][] = [];
  host.querySelectorAll('.player-timedtext-text-container').forEach((container) => {
    const boxes: NetflixSpanBox[] = [];
    container.querySelectorAll('span').forEach((node) => {
      if (!(node instanceof HTMLElement) || node.parentElement !== container) return;
      const box = netflixSpanBox(node);
      if (box) boxes.push(box);
    });
    if (boxes.length) groups.push(boxes);
  });
  return netflixPaintedCaptionBox(groups);
}

function netflixSpanBox(span: HTMLElement): NetflixSpanBox | null {
  if (!span.textContent?.trim()) return null;
  const style = window.getComputedStyle(span);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.05) return null;
  const rect = span.getBoundingClientRect();
  if (rect.width <= 1 || rect.height <= 1) return null;
  const lineHeight = Number.parseFloat(style.lineHeight);
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    lineHeight: lineHeight > 0 ? lineHeight : 0
  };
}

/** Provider-owned native renderer geometry and lifecycle. */
export function createNetflixHostCaptions(doc: Document | null = typeof document === 'undefined' ? null : document) {
  let previous: NetflixCaptionBox | null = null;
  let previousHost: HTMLElement | null = null;
  return {
    read(): HostCaptionLayout | null {
      if (!doc?.documentElement.classList.contains('theater-everywhere-netflix-stage')) return null;
      const node = doc.querySelector('.watch-video .player-timedtext');
      const host = node instanceof HTMLElement && node.isConnected ? node : null;
      if (host !== previousHost) previous = null;
      previousHost = host;
      previous = nextNetflixCaptionBox(previous, host ? readNetflixPaintedCaption(host) : null, host !== null);
      return host && previous ? { ...previous, motionTarget: host } : null;
    },
    observe(onChange: () => void): () => void {
      if (!doc?.documentElement) return () => {};
      const scope = new DisposableScope();
      observeNetflixCaptionDock(scope, doc.documentElement, onChange);
      return () => scope.dispose();
    },
    reset(): void { previous = null; previousHost = null; }
  };
}
