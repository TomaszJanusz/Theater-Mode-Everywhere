import { captionPreferenceHost, upsertHostPreference } from './caption-preference';
import type { AudioTrack, AudioTrackKind } from './types';

/**
 * Saved audio language per service, like `captionPreferenceByHost`: the same service key and
 * size cap, one value per service. A value is `'original'` (the track the host marks as the
 * original recording) or a canonical BCP-47 tag. No entry means the service decides.
 */
export const AUDIO_PREF_STORAGE_KEY = 'audioPreferenceByHost';
export const ORIGINAL_AUDIO = 'original';

/** Canonical BCP-47 tag, or null for anything else, including `und`. */
export function normalizeLanguageTag(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/_/g, '-');
  if (!trimmed || trimmed.length > 35) return null;
  try {
    const [tag] = Intl.getCanonicalLocales(trimmed);
    return tag && tag.toLowerCase() !== 'und' ? tag : null;
  } catch {
    return null;
  }
}

function primarySubtag(tag: string): string {
  return tag.split('-')[0].toLowerCase();
}

export function resolveAudioPreference(value: unknown): string | null {
  // Checked first: "original" is also a syntactically valid language subtag.
  if (value === ORIGINAL_AUDIO) return ORIGINAL_AUDIO;
  return normalizeLanguageTag(value);
}

/** Shared by load and storage changes; invalid entries are dropped, as for subtitles. */
export function resolveAudioPreferences(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const map: Record<string, string> = {};
  for (const [host, item] of Object.entries(value as Record<string, unknown>)) {
    const key = captionPreferenceHost(host);
    const preference = resolveAudioPreference(item);
    if (key && preference) map[key] = preference;
  }
  return map;
}

/** Saves `preference` for the service of `host`; null returns that service to its default. */
export function upsertAudioPreference(map: Record<string, string>, host: string, preference: string | null): Record<string, string> {
  if (preference !== null) return upsertHostPreference(map, host, preference);
  const key = captionPreferenceHost(host);
  if (!key || !(key in map)) return map;
  const rest = { ...map };
  delete rest[key];
  return rest;
}

/**
 * What a viewer's pick says about later items: the original, or the track's language. Picks of
 * description or commentary tracks, and of tracks without a language, save nothing, because
 * automatic selection would then choose a different kind of track.
 */
export function audioPreferenceForTrack(track: AudioTrack): string | null {
  if (track.kind === 'original') return ORIGINAL_AUDIO;
  if (track.kind === 'description' || track.kind === 'commentary') return null;
  return normalizeLanguageTag(track.languageTag);
}

/** Description and commentary tracks never win automatically; they are chosen by hand. */
const AUTOMATIC_KIND_RANK: Partial<Record<AudioTrackKind, number>> = { original: 0, dub: 1, unknown: 2 };

function normalizeName(text: string): string {
  return text.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function languageNames(tag: string, locales: readonly string[]): string[] {
  const names = new Set<string>();
  for (const locale of [...locales, tag, 'en']) {
    try {
      const display = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' });
      for (const code of [tag, primarySubtag(tag)]) {
        const name = display.of(code);
        if (name) names.add(normalizeName(name));
      }
    } catch {
      // An unsupported locale only removes one spelling.
    }
  }
  return [...names];
}

/** Hosts that give no tag still name the language first, as in "English (US) original". */
function labelNamesLanguage(label: string, tag: string, locales: readonly string[]): boolean {
  const text = normalizeName(label);
  return Boolean(text) && languageNames(tag, locales).some(name =>
    text === name || text.startsWith(`${name} `) || text.startsWith(`${name}(`) || text.startsWith(`${name},`));
}

/** 3 exact tag, 2 same language, 1 label only, 0 no match. */
function languageScore(track: AudioTrack, preferred: string, locales: readonly string[]): number {
  const tag = normalizeLanguageTag(track.languageTag);
  if (tag) {
    if (tag.toLowerCase() === preferred.toLowerCase()) return 3;
    return primarySubtag(tag) === primarySubtag(preferred) ? 2 : 0;
  }
  return labelNamesLanguage(track.label, preferred, locales) ? 1 : 0;
}

/**
 * The track a saved preference asks for, or null when the host should keep its choice: no
 * preference, no match, or an ambiguous match (such as `zh` with both scripts offered).
 * @param locales Locales whose language names may appear in labels without a tag.
 */
export function pickPreferredAudioTrack(tracks: readonly AudioTrack[], preference: string | null, locales: readonly string[]): AudioTrack | null {
  if (preference === null) return null;
  if (preference === ORIGINAL_AUDIO) {
    const originals = tracks.filter(track => track.kind === 'original');
    return originals.length === 1 ? originals[0] : null;
  }
  const ranked = tracks.flatMap(track => {
    const kind = AUTOMATIC_KIND_RANK[track.kind];
    const score = languageScore(track, preference, locales);
    return kind === undefined || score === 0 ? [] : [{ track, score, kind }];
  }).sort((a, b) => b.score - a.score || a.kind - b.kind);
  const [best, next] = ranked;
  if (!best) return null;
  return next && next.score === best.score && next.kind === best.kind ? null : best.track;
}
