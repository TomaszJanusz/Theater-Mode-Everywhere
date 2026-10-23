import type { Target } from './model';

/**
 * The repository is public and the target list is private, so no output of the lane may
 * name a target: logs, `results.json` (uploaded) and the rolling issues all go through here.
 */
type Named = Pick<Target, 'pageType' | 'url'>;

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ANY_URL = /\bhttps?:\/\/[^\s"'<>|)\]]+/gi;

/** Every spelling of a target an error message might repeat: the URL, its origin, host and path. */
function spellings({ url }: Named): string[] {
  const parsed = new URL(url);
  const path = `${parsed.pathname}${parsed.search}`;
  return [url, parsed.href, parsed.origin, parsed.host, parsed.hostname, ...(path.length > 1 ? [path] : [])];
}

/** Values to hand to `::add-mask::` before any output, so the runner hides them even where redaction misses. */
export function maskValues(targets: readonly Named[]): string[] {
  return [...new Set(targets.flatMap(spellings).filter(value => value.length > 3 && !/[\r\n]/.test(value)))];
}

/** Replaces each target's URL, host and path with `<pageType>`, then any remaining URL with `<url>`. */
export function redactorFor(targets: readonly Named[]): (text: string) => string {
  const rules = targets
    .flatMap(target => spellings(target).map(value => [new RegExp(escape(value), 'gi'), `<${target.pageType}>`] as const))
    .sort((a, b) => b[0].source.length - a[0].source.length);
  return text => scrubUrls(rules.reduce((out, [pattern, label]) => out.replace(pattern, label), text));
}

/** For readers that never see the target list (the issue job): no URL survives, whatever its host. */
export const scrubUrls = (text: string): string => text.replace(ANY_URL, '<url>');
