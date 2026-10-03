const CONTENT_TITLE_MAX = 180;

/** Collapses whitespace and drops empty or non-string labels before they reach the title HUD. */
export function sanitizeContentTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.length > CONTENT_TITLE_MAX ? cleaned.slice(0, CONTENT_TITLE_MAX).trim() : cleaned;
}

function nestedText(value: unknown): string | null {
  const direct = sanitizeContentTitle(value);
  if (direct) return direct;
  if (!value || typeof value !== 'object') return null;
  const record = value as { simpleText?: unknown; runs?: Array<{ text?: unknown }> };
  return sanitizeContentTitle(record.simpleText) || sanitizeContentTitle(record.runs?.[0]?.text);
}

const VIMEO_SITE_SUFFIX = /\s*[|\-–—]\s*(?:videos?\s*&\s*movies\s+on\s+)?vimeo(?:\.com)?$/i;
const GENERIC_VIMEO_TITLE = /^(?:vimeo|log in|join|sign up|verify to continue)$/i;

/** Watch-page title. Player config wins at the call site; this is the page fallback. */
export function vimeoPageTitle(ogTitle: unknown, heading: unknown, documentTitle: unknown): string | null {
  for (const candidate of [ogTitle, heading, documentTitle]) {
    const raw = typeof candidate === 'string' ? candidate.replace(VIMEO_SITE_SUFFIX, '') : candidate;
    const cleaned = sanitizeContentTitle(raw);
    if (!cleaned || GENERIC_VIMEO_TITLE.test(cleaned) || /all-in-one video platform/i.test(cleaned)) continue;
    return cleaned;
  }
  return null;
}

export function youtubePlayerTitle(videoDetails: unknown, microformatTitle?: unknown): string | null {
  const details = videoDetails && typeof videoDetails === 'object'
    ? nestedText((videoDetails as { title?: unknown }).title)
    : null;
  return details || nestedText(microformatTitle);
}

export function disneyRecordTitle(record: Record<string, unknown>): string | null {
  const text = record.text;
  if (text && typeof text === 'object') {
    const title = (text as { title?: unknown }).title;
    if (title && typeof title === 'object') {
      const full = sanitizeContentTitle((title as { full?: unknown }).full);
      if (full) return full;
    }
  }
  const visuals = record.visuals;
  if (visuals && typeof visuals === 'object') {
    const visualTitle = sanitizeContentTitle((visuals as { title?: unknown }).title);
    if (visualTitle) return visualTitle;
  }
  return null;
}

/** First catalog title in a Disney playback or explore payload. */
export function findDisneyContentTitle(raw: unknown): string | null {
  let found: string | null = null;
  let budget = 5000;
  const walk = (node: unknown, depth: number) => {
    if (found || budget <= 0 || node == null || depth > 14) return;
    budget -= 1;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const title = disneyRecordTitle(record);
    if (title) {
      found = title;
      return;
    }
    for (const value of Object.values(record)) walk(value, depth + 1);
  };
  walk(raw, 0);
  return found;
}
