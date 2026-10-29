/** Declarative admission shared by page requests and the registry-free background broker. */
export type MediaFetchRule = {
  kind: 'caption-track' | 'storyboard-vtt' | 'storyboard-json' | 'chapters';
  host: string;
  /** Anchored pathname expression, validated when the descriptor is generated. */
  pathname: string;
};

export function matchesMediaFetchRules(
  rules: readonly MediaFetchRule[], request: { kind: string; url: string }, base?: string
): boolean {
  try {
    const url = new URL(request.url, base);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && rules.some(rule => rule.kind === request.kind && rule.host === url.hostname && new RegExp(rule.pathname).test(url.pathname));
  } catch {
    return false;
  }
}
