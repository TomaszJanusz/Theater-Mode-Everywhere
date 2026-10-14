import { MAX_CAPTION_BYTES } from '../../platform/media-url-policy';
import {
  findCachedTimedtextRecord,
  type CachedTimedtext
} from '../../media-features/youtube-caption-url';

/**
 * UTF-16 code units (`String.length`) allowed for one cached timedtext string.
 *
 * `MAX_CAPTION_BYTES` is a different limit: UTF-8 bytes of one network body
 * (`ArrayBuffer.byteLength` / `Content-Length`). The numbers match because an
 * ASCII body of that many bytes decodes to that many code units. A non-ASCII
 * body of the same byte length decodes to fewer code units, and a string of
 * this many non-ASCII code units encodes to more UTF-8 bytes.
 */
export const MAX_TIMEDTEXT_STRING_LENGTH = MAX_CAPTION_BYTES;

/**
 * Total `String.length` retained by one realm's timedtext body cache.
 *
 * A 120-minute word-level json3 track, built like the parser fixture at
 * 150 words/minute and six words per event, is 722_016 code units (and
 * 722_016 UTF-8 bytes when the words are ASCII). Four of those tracks are
 * 2_888_064 code units: the active language, another language of the same
 * video, the previous video, and one extra format or recent track.
 * `MAX_TIMEDTEXT_STRING_LENGTH` is below this total, so one admitted active
 * track always fits. This is not a byte budget and not the old 20-slot ceiling.
 */
export const TIMEDTEXT_CACHE_STRING_BUDGET = 2_888_064;

export type TimedtextCachePut = 'stored' | 'unchanged' | 'rejected';

type Entry = {
  record: CachedTimedtext;
  stringLength: number;
  tick: number;
};

function sameTrack(left: CachedTimedtext, right: CachedTimedtext): boolean {
  return left.videoId === right.videoId
    && left.lang === right.lang
    && left.tlang === right.tlang
    && left.kind === right.kind
    && left.fmt === right.fmt;
}

/**
 * LRU of timedtext bodies for one JavaScript realm (MAIN top and MAIN iframe
 * each have their own). The active track is not evicted. Other tracks for the
 * current video outrank the previous video, which outranks older videos.
 */
export class TimedtextBodyCache {
  private entries: Entry[] = [];
  private active: Entry | null = null;
  private pageVideoId: string | null = null;
  private previousVideoId: string | null = null;
  private tick = 0;

  notePageVideo(videoId: string | null): void {
    if (!videoId || videoId === this.pageVideoId) return;
    this.previousVideoId = this.pageVideoId;
    this.pageVideoId = videoId;
    if (this.active?.record.videoId && this.active.record.videoId !== videoId) {
      this.active = null;
    }
  }

  put(record: CachedTimedtext): TimedtextCachePut {
    if (!record.body || record.body.length > MAX_TIMEDTEXT_STRING_LENGTH) return 'rejected';
    const index = this.entries.findIndex((entry) => sameTrack(entry.record, record));
    let wasActive = false;
    if (index >= 0) {
      const current = this.entries[index];
      if (current.record.body === record.body && current.record.url === record.url) {
        current.tick = ++this.tick;
        return 'unchanged';
      }
      if (current.record.body === record.body) {
        current.record = { ...current.record, url: record.url };
        current.tick = ++this.tick;
        return 'stored';
      }
      wasActive = this.active === current;
      this.entries.splice(index, 1);
      if (wasActive) this.active = null;
    }
    const entry: Entry = {
      record,
      stringLength: record.body.length,
      tick: ++this.tick
    };
    this.entries.push(entry);
    if (wasActive) this.active = entry;
    this.evict();
    return this.entries.includes(entry) ? 'stored' : 'rejected';
  }

  /** Marks the track returned for this request as the one playback is using. */
  find(url: string): string | null {
    const match = findCachedTimedtextRecord(this.records(), url);
    if (!match?.body) return null;
    const entry = this.entries.find((item) => item.record === match);
    if (!entry) return null;
    entry.tick = ++this.tick;
    this.active = entry;
    return entry.record.body;
  }

  records(): CachedTimedtext[] {
    return this.entries.map((entry) => entry.record);
  }

  retainedStringLength(): number {
    return this.entries.reduce((sum, entry) => sum + entry.stringLength, 0);
  }

  trackCount(): number {
    return this.entries.length;
  }

  private rank(entry: Entry): number {
    const videoId = entry.record.videoId;
    if (videoId && videoId === this.pageVideoId) return 2;
    if (videoId && videoId === this.previousVideoId) return 1;
    return 0;
  }

  private victim(): Entry | null {
    let chosen: Entry | null = null;
    let chosenRank = 0;
    for (const entry of this.entries) {
      if (entry === this.active) continue;
      const rank = this.rank(entry);
      if (!chosen || rank < chosenRank || (rank === chosenRank && entry.tick < chosen.tick)) {
        chosen = entry;
        chosenRank = rank;
      }
    }
    return chosen;
  }

  private evict(): void {
    while (this.retainedStringLength() > TIMEDTEXT_CACHE_STRING_BUDGET) {
      const entry = this.victim();
      if (!entry) break;
      this.entries.splice(this.entries.indexOf(entry), 1);
    }
  }
}

export function createTimedtextBodyCache(): TimedtextBodyCache {
  return new TimedtextBodyCache();
}
