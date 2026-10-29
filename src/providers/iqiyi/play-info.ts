import type { Chapter } from '../../media-features/types';

/**
 * What iq.com's own play-info response (`window.__playerdata__.__dash.data`) says about the
 * playing episode. Times are seconds. `duration` lets the reader reject data left over from the
 * previous episode, which the page replaces asynchronously after a client-side navigation.
 */
export type IqiyiSnapshot = {
  tvid: string;
  duration: number;
  /** End of the opening segment the host's "skip intro/outro" setting jumps over (`p.bt`). */
  introEnd: number | null;
  /** Start and end of the closing segment (`p.et`, `p.ete`). */
  outroStart: number | null;
  outroEnd: number | null;
};

const MAX_SECONDS = 24 * 60 * 60;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function seconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_SECONDS ? value : null;
}

/** Validates the page-owned response before it crosses from MAIN into the isolated world. */
export function normalizeIqiyiPlayInfo(raw: unknown): IqiyiSnapshot | null {
  const data = record(record(raw).data);
  const tvid = typeof data.tvid === 'number' || typeof data.tvid === 'string' ? String(data.tvid) : '';
  const video = record((Array.isArray(record(data.program).video) ? record(data.program).video as unknown[] : [])[0]);
  const duration = seconds(video.duration);
  if (!/^\d{1,20}$/.test(tvid) || !duration) return null;
  const p = record(data.p);
  return { tvid, duration, introEnd: seconds(p.bt), outroStart: seconds(p.et), outroEnd: seconds(p.ete) };
}

/** Skip windows are intro/outro ranges, not named chapters, as on Bilibili.tv. */
export function iqiyiChapters(snapshot: IqiyiSnapshot | null, mediaDuration: number): Chapter[] {
  if (!snapshot || !Number.isFinite(mediaDuration) || Math.abs(snapshot.duration - mediaDuration) > 2) return [];
  const chapters: Chapter[] = [];
  const add = (start: number | null, end: number | null, title: string) => {
    if (start !== null && end !== null && end > start && end <= mediaDuration + 2) {
      chapters.push({ start, end, title, source: 'iqiyi', confidence: 'high' });
    }
  };
  add(0, snapshot.introEnd, 'Intro');
  add(snapshot.outroStart, snapshot.outroEnd, 'Outro');
  return chapters;
}
