import {
  CRUNCHYROLL_SKIP_TYPES,
  crunchyrollMediaId,
  type CrunchyrollSkipType,
  type CrunchyrollSkipWindow
} from '../../media-features/parsers/crunchyroll';
import { publishHiddenJson } from '../../platform/hidden-json';

export const CRUNCHYROLL_SKIP_SNAPSHOT_ID = 'theater-everywhere-crunchyroll-skip-windows';
const MAX_SNAPSHOT_CHARS = 2000;

function canPublish(): boolean {
  return typeof document !== 'undefined'
    && typeof document.getElementById === 'function'
    && typeof document.createElement === 'function';
}

/** MAIN-world publication. The isolated player reads the same node. */
export function publishCrunchyrollSkipWindows(mediaId: string, windows: readonly CrunchyrollSkipWindow[]): void {
  if (!canPublish()) return;
  const id = crunchyrollMediaId(mediaId);
  if (!id || windows.length === 0) {
    publishHiddenJson(CRUNCHYROLL_SKIP_SNAPSHOT_ID, null);
    return;
  }
  publishHiddenJson(CRUNCHYROLL_SKIP_SNAPSHOT_ID, { mediaId: id, windows });
}

export function clearCrunchyrollSkipWindows(): void {
  if (!canPublish()) return;
  publishHiddenJson(CRUNCHYROLL_SKIP_SNAPSHOT_ID, null);
}

/** Ignores a snapshot for a different episode. Bounds are checked again. */
export function readCrunchyrollSkipWindows(doc: Document, mediaId: string): CrunchyrollSkipWindow[] {
  const id = crunchyrollMediaId(mediaId);
  const text = doc.getElementById(CRUNCHYROLL_SKIP_SNAPSHOT_ID)?.textContent;
  if (!id || !text || text.length > MAX_SNAPSHOT_CHARS) return [];
  try {
    const data = JSON.parse(text) as { mediaId?: unknown; windows?: unknown };
    if (crunchyrollMediaId(data.mediaId) !== id || !Array.isArray(data.windows)) return [];
    const windows: CrunchyrollSkipWindow[] = [];
    for (const row of data.windows.slice(0, CRUNCHYROLL_SKIP_TYPES.length)) {
      if (!row || typeof row !== 'object') continue;
      const item = row as { type?: unknown; start?: unknown; end?: unknown };
      const type = CRUNCHYROLL_SKIP_TYPES.find(kind => kind === item.type);
      if (!type || typeof item.start !== 'number' || typeof item.end !== 'number') continue;
      if (!Number.isFinite(item.start) || !Number.isFinite(item.end)) continue;
      if (item.start < 0 || item.end <= item.start || item.end > 12 * 60 * 60) continue;
      windows.push({ type, start: item.start, end: item.end });
    }
    return windows;
  } catch {
    return [];
  }
}

export type { CrunchyrollSkipType, CrunchyrollSkipWindow };
