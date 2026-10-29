import { sanitizeContentTitle } from '../../media-features/content-title';

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
