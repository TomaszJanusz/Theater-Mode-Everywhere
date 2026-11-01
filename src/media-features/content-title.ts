const CONTENT_TITLE_MAX = 180;

/** Collapses whitespace and drops empty or non-string labels before they reach the title HUD. */
export function sanitizeContentTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.length > CONTENT_TITLE_MAX ? cleaned.slice(0, CONTENT_TITLE_MAX).trim() : cleaned;
}

/** Title HUD content. The subtitle is a separate host label, such as an episode. */
export type ContentTitle = { title: string; subtitle: string | null };

export function contentTitle(title: unknown, subtitle?: unknown): ContentTitle | null {
  const cleaned = sanitizeContentTitle(title);
  return cleaned ? { title: cleaned, subtitle: sanitizeContentTitle(subtitle) } : null;
}

function nestedText(value: unknown): string | null {
  const direct = sanitizeContentTitle(value);
  if (direct) return direct;
  if (!value || typeof value !== 'object') return null;
  const record = value as { simpleText?: unknown; runs?: Array<{ text?: unknown }> };
  return sanitizeContentTitle(record.simpleText) || sanitizeContentTitle(record.runs?.[0]?.text);
}

export function youtubePlayerTitle(videoDetails: unknown, microformatTitle?: unknown): string | null {
  const details = videoDetails && typeof videoDetails === 'object'
    ? nestedText((videoDetails as { title?: unknown }).title)
    : null;
  return details || nestedText(microformatTitle);
}
