const CONTENT_TITLE_MAX = 180;

/** Collapses whitespace and drops empty or non-string labels before they reach the title HUD. */
export function sanitizeContentTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.length > CONTENT_TITLE_MAX ? cleaned.slice(0, CONTENT_TITLE_MAX).trim() : cleaned;
}

/**
 * Who published the playing item, as its provider read it from the host. The byline view checks every field again at
 * its boundary (lengths, https, the provider's own link and image hosts), so a value here is only a candidate.
 */
export type ContentAuthor = {
  /** The host's stable id (channel id, login): the key, and duplicates are dropped by it. */
  id: string;
  name: string;
  /** The channel page, on one of the provider's own hosts; null shows the name without a link. */
  url: string | null;
  /** An image on a host the provider declares; null shows a monogram. */
  avatarUrl: string | null;
  verified: boolean;
  /** A figure already in the page data, such as "1.26M subscribers"; never fetched for this. */
  stat: string | null;
};

/**
 * Title HUD content. The subtitle is a separate host label, such as an episode. Authors are published with the title,
 * from the same adapter and in the same epoch, so the title's stale-result checks cover them.
 */
export type ContentTitle = { title: string; subtitle: string | null; authors?: readonly ContentAuthor[] | null };

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
