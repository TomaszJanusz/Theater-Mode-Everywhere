import type { PlaylistPreview } from '../../playlist-nav';
import { collectElement, type CollectedControl, type PlaylistNavigationHelpers } from './observed';

export function isVimeoShowcaseStepHref(href: string | null | undefined): boolean {
  if (!href) return false;
  try {
    const url = new URL(href, 'https://vimeo.com');
    return url.origin === 'https://vimeo.com'
      && /^\/showcase\/[^/]+\/?$/.test(url.pathname)
      && url.searchParams.has('video');
  } catch {
    return false;
  }
}

export function readVimeoShowcaseControls(root: ParentNode): CollectedControl[] {
  const controls: CollectedControl[] = [];
  root.querySelectorAll('button[data-href]').forEach((element) => {
    if (!(element instanceof HTMLElement)) return;
    const href = element.getAttribute('data-href');
    if (!isVimeoShowcaseStepHref(href)) return;
    controls.push(collectElement(element, 'vimeo-showcase', null, (context) => ({
      preview: vimeoShowcasePreview(context.page, href, context.helpers),
      restarts: false
    })));
  });
  return controls;
}

export function vimeoShowcasePreview(
  root: ParentNode,
  stepHref: string | null,
  helpers: PlaylistNavigationHelpers
): PlaylistPreview | null {
  const videoId = showcaseVideoId(stepHref);
  if (!videoId) return null;
  for (const node of root.querySelectorAll('a[href*="video="]')) {
    if (!(node instanceof HTMLAnchorElement)) continue;
    if (showcaseVideoId(node.getAttribute('href')) !== videoId) continue;
    const image = [...node.querySelectorAll('img')].find((item) => {
      return /\/video\//.test(item.currentSrc || item.getAttribute('src') || '');
    });
    if (!image) continue;
    const preview = helpers.sanitizePreview(
      node.querySelector('p')?.textContent || '',
      image.currentSrc || image.getAttribute('src') || ''
    );
    if (preview) return preview;
  }
  return null;
}

function showcaseVideoId(href: string | null | undefined): string | null {
  if (!href || !isVimeoShowcaseStepHref(href)) return null;
  try {
    return new URL(href, 'https://vimeo.com').searchParams.get('video');
  } catch {
    return null;
  }
}
