import type { CaptionCue } from '../../media-features/types';

/** A caption file named by a player's `caption-url`. */
export type RedditCaptionFile = {
  url: string;
  /** BCP-47 tag from the file name (`wh_ben_en.vtt`, `advertiser_en.vtt`), or '' when it names none. */
  language: string;
};

const LANGUAGE_SUFFIX = /_([a-z]{2,3}(?:-[a-z0-9]{2,8})?)$/i;

/**
 * The player's caption file, only when it is a WebVTT file on Reddit's video CDN: the attribute is page data, and
 * the descriptor's `mediaFetch` rule admits nothing else.
 */
export function redditCaptionFile(value: string | null): RedditCaptionFile | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'v.redd.it' || url.username || url.password || url.port) return null;
  const name = /^\/[A-Za-z0-9]+\/([A-Za-z0-9_-]+)\.vtt$/.exec(url.pathname)?.[1];
  if (!name) return null;
  return { url: url.href, language: LANGUAGE_SUFFIX.exec(name)?.[1]?.toLowerCase() ?? '' };
}

/** Cues closer than this count as one continuous line: the file's word cues abut exactly. */
const CONTIGUOUS_S = 0.05;

/**
 * Reddit times its captions word by word: one cue per spoken word, each repeating the whole line with the current
 * word in `<u>`. The shared parser drops that emphasis, which leaves runs of identical cues; they are folded into one
 * cue per line, so the overlay shows each line once instead of replacing it at every word.
 */
export function mergeRedditCues(cues: readonly CaptionCue[]): CaptionCue[] {
  const merged: CaptionCue[] = [];
  for (const cue of cues) {
    const last = merged.at(-1);
    if (last && last.text === cue.text && cue.start - last.end <= CONTIGUOUS_S && cue.end >= last.end) {
      last.end = cue.end;
    } else {
      merged.push({ start: cue.start, end: cue.end, text: cue.text });
    }
  }
  return merged;
}
