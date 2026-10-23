import type { FixtureNode, HostFixture, RecordedMedia, RecordedPlayback } from './format';
import type { RawNode } from './page-inspect';

/**
 * Automatic sanitization: nothing is redacted by hand. Text nodes, URLs, artwork and unlisted
 * attributes never leave the page; what does is reduced to structure. Ids and opaque values keep
 * their shape, so the provider's format checks still accept them; titles and labels keep their
 * length. `findLeaks` then refuses any recording in which a known pattern survived.
 */
export interface SanitizeContext {
  /** Strings that identify the page or its owner: URL path and query values, title parts, recorded titles. */
  identifying: readonly string[];
  /** `aria-label` values the provider reads (native control labels); every other label is replaced. */
  labels: readonly string[];
  /** Attributes holding host content ids, replaced by a same-shape stand-in. */
  opaque: readonly string[];
}

/** Collected in the page; anything else (href, src, title, alt, data-* user fields) is never read. */
export const BASE_ATTRIBUTES = ['id', 'class', 'role', 'hidden', 'aria-hidden', 'aria-label', 'aria-expanded', 'aria-pressed', 'data-a-target', 'data-test-selector', 'type', 'disabled'] as const;
const FLAG_VALUES = new Set(['', 'true', 'false']);
const SAFE_TOKEN = /^[A-Za-z_][\w-]{0,59}$/;

/** Patterns that must never appear in a committed recording (`findLeaks`), also scrubbed on the way in. */
const SECRET_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ['url', /\b(?:https?:)?\/\/[^\s"'<>]+/i],
  ['email', /[\w.+-]{1,64}@[a-z\d-]{1,63}\.[a-z]{2,24}/i],
  ['jwt', /\beyJ[\w-]{8,}\.[\w-]{8,}/],
  ['uuid', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ['hex token', /\b[0-9a-f]{16,}\b/i],
  ['long number', /\d{7,}/],
  ['opaque token', /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/]
];

const FILLER = 'Recorded host text ';
/** Same length (in code points), no content. */
export function placeholder(value: string): string {
  const text = [...value].map((_, index) => FILLER[index % FILLER.length]).join('');
  return text.endsWith(' ') ? `${text.slice(0, -1)}x` : text;
}
/** Same shape: letters, digits and separators keep their class and case, so format checks still pass. */
export const sameShape = (value: string): string => value.replace(/[a-z]/g, 'x').replace(/[A-Z]/g, 'X').replace(/\d/g, '0');

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function identifiers(context: SanitizeContext): RegExp | null {
  const parts = [...new Set(context.identifying.map(part => part.trim()).filter(part => part.length >= 3))].sort((a, b) => b.length - a.length);
  return parts.length ? new RegExp(parts.map(escapeRegExp).join('|'), 'i') : null;
}

const leaks = (value: string, identifying: RegExp | null): boolean =>
  SECRET_PATTERNS.some(([, pattern]) => pattern.test(value)) || Boolean(identifying?.test(value));

/** One cleaner per recording, so renumbered ids stay consistent across the fragment. */
function attributeCleaner(context: SanitizeContext): (name: string, value: string) => string | null {
  const identifying = identifiers(context);
  const ids = new Map<string, string>();
  const isFlag = (name: string): boolean => name === 'hidden' || name === 'disabled' || (name.startsWith('aria-') && name !== 'aria-label');
  const cleanClass = (value: string): string | null => {
    const kept = value.split(/\s+/).filter(token => SAFE_TOKEN.test(token) && !leaks(token, identifying));
    return kept.length ? kept.join(' ') : null;
  };
  const cleanId = (value: string): string => {
    if (SAFE_TOKEN.test(value) && !/\d{3}/.test(value) && !leaks(value, identifying)) return value;
    if (!ids.has(value)) ids.set(value, `fixture-id-${ids.size + 1}`);
    return ids.get(value) ?? value;
  };
  return (name, value) => {
    if (isFlag(name)) return FLAG_VALUES.has(value) ? value : null;
    if (name === 'aria-label') return context.labels.includes(value) ? value : placeholder(value);
    if (context.opaque.includes(name)) return sameShape(value);
    if (name === 'class') return cleanClass(value);
    if (name === 'id') return cleanId(value);
    return /^[\w:.-]{1,80}$/.test(value) && !leaks(value, identifying) ? value : null;
  };
}

/** Reduces an inspected page tree to a committed fragment. */
export function sanitizeTree(raw: RawNode, context: SanitizeContext): FixtureNode {
  const attribute = attributeCleaner(context);
  const visit = (node: RawNode): FixtureNode => {
    const attrs: Record<string, string> = {};
    for (const [name, value] of Object.entries(node.attrs)) {
      const clean = attribute(name, value);
      if (clean !== null) attrs[name] = clean;
    }
    // Computed layout only: keywords, numbers and px/matrix values, never a url().
    const style = node.style.split(';').filter(rule => /^[a-z-]+:[\w\s.,()%-]+$/.test(rule) && !/url\(/i.test(rule)).join(';');
    return {
      tag: node.tag,
      ...(Object.keys(attrs).length ? { attrs } : {}),
      ...(style ? { style } : {}),
      ...(node.children.length ? { children: node.children.map(visit) } : {})
    };
  };
  return visit(raw);
}

const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/** Provider data keeps its shape and sizes; every free-text value is replaced, ids are renumbered. */
export function sanitizeMedia(media: RecordedMedia): RecordedMedia {
  const text = (value: string | null): string | null => (value === null ? null : placeholder(value));
  return {
    title: text(media.title),
    subtitle: text(media.subtitle),
    mediaId: media.mediaId === null ? null : sameShape(media.mediaId),
    captionTracks: media.captionTracks.map((track, index) => ({
      id: `track-${index + 1}`,
      language: LANGUAGE.test(track.language) ? track.language : 'und',
      label: placeholder(track.label),
      kind: track.kind,
      autoGenerated: track.autoGenerated
    })),
    chapters: media.chapters.map(chapter => ({ start: Math.round(chapter.start), ...(chapter.end === undefined ? {} : { end: Math.round(chapter.end) }), title: placeholder(chapter.title) }))
  };
}

export const sanitizePlayback = (playback: RecordedPlayback): RecordedPlayback => ({
  ...playback, duration: playback.duration === null ? null : Math.round(playback.duration)
});

/** Every string of the recording except the capture metadata's host build id, with its location. */
function* strings(value: unknown, at: string): Generator<[string, string]> {
  if (typeof value === 'string') yield [at, value];
  else if (Array.isArray(value)) for (const [index, item] of value.entries()) yield* strings(item, `${at}[${index}]`);
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (at === 'capture' && key === 'hostVersion') continue;
      yield* strings(item, at ? `${at}.${key}` : key);
    }
  }
}

/** Where a recording still holds a URL, token, id-like number or identifying string; empty means publishable. */
export function findLeaks(fixture: HostFixture, identifying: readonly string[] = []): string[] {
  const pattern = identifiers({ identifying, labels: [], opaque: [] });
  const found: string[] = [];
  for (const [at, value] of strings(fixture, '')) {
    const secret = SECRET_PATTERNS.find(([, rule]) => rule.test(value));
    if (secret) found.push(`${at}: ${secret[0]}`);
    else if (pattern?.test(value)) found.push(`${at}: identifying string`);
  }
  return found;
}
