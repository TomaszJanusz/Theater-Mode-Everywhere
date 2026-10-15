import { sanitizeContentTitle } from '../../media-features/content-title';
import {
  GenericTitleTracker,
  parseJsonLdVideoObjects,
  type GenericTitleCandidates,
  type MediaIdentity,
  type VideoObjectCandidate
} from '../../media-features/page-title';

const META_SELECTOR = 'meta[property="og:title"], meta[name="twitter:title"], meta[property="og:site_name"]';
const JSON_LD_SELECTOR = 'script[type="application/ld+json"]';
const TEXT_CHANGES: MutationObserverInit = { childList: true, characterData: true, subtree: true };

function isTitleNode(node: Node): boolean {
  return node.nodeName === 'TITLE' || node.nodeName === 'META'
    || (node.nodeName === 'SCRIPT' && (node as HTMLScriptElement).type === 'application/ld+json');
}

function metaContent(doc: Document, selector: string): string | null {
  return doc.querySelector<HTMLMetaElement>(selector)?.content ?? null;
}

function labelElements(video: HTMLVideoElement): Element[] {
  const ids = video.getAttribute('aria-labelledby')?.split(/\s+/).filter(Boolean) ?? [];
  if (ids.length === 0) return [];
  const root = video.getRootNode() as Document | ShadowRoot;
  return ids.map((id) => root.getElementById?.(id)).filter((el): el is HTMLElement => Boolean(el));
}

/**
 * The page's only H1 inside the nearest container it shares with this video,
 * provided that container holds no other video. An H1 that only shares
 * `<body>` with the video may name the whole page and is not used.
 */
export function tiedHeading(video: HTMLVideoElement): HTMLHeadingElement | null {
  const doc = video.ownerDocument;
  const headings = Array.from(doc.querySelectorAll('h1'));
  if (headings.length === 0) return null;
  for (let node = video.parentElement; node && node !== doc.body && node !== doc.documentElement; node = node.parentElement) {
    const container = node;
    const inside = headings.filter((heading) => container.contains(heading));
    if (inside.length === 0) continue;
    return inside.length === 1 && node.querySelectorAll('video').length === 1 ? inside[0] : null;
  }
  return null;
}

/** Properties owned by this item, not by an item nested inside it. */
function microdataProp(scope: Element, name: string): Element[] {
  return Array.from(scope.querySelectorAll(`[itemprop~="${name}"]`))
    .filter((el) => el.parentElement?.closest('[itemscope]') === scope);
}

function microdataValue(el: Element): string | null {
  return el.getAttribute('content') || el.getAttribute('href') || el.getAttribute('src') || el.textContent;
}

function microdataVideoObjects(doc: Document, video: HTMLVideoElement): VideoObjectCandidate[] {
  return Array.from(doc.querySelectorAll('[itemscope][itemtype]'))
    .filter((scope) => /schema\.org\/VideoObject\b/i.test(scope.getAttribute('itemtype') || ''))
    .map((scope) => ({
      name: sanitizeContentTitle(microdataProp(scope, 'name').map(microdataValue)[0]),
      contentUrls: microdataProp(scope, 'contentUrl').map(microdataValue).filter((url): url is string => Boolean(url)),
      embedUrls: microdataProp(scope, 'embedUrl').map(microdataValue).filter((url): url is string => Boolean(url)),
      containsMedia: scope.contains(video)
    }));
}

/**
 * Reads generic title candidates for one video and observes the elements
 * they come from. Page metadata is read only when no service integration
 * names the media; the element's own label is always available.
 */
export class GenericTitleSource {
  private tracker = new GenericTitleTracker();
  private jsonLd: { text: string; objects: VideoObjectCandidate[] } = { text: '', objects: [] };

  constructor(private video: HTMLVideoElement, private pageMetadata: boolean) {}

  read(): string | null {
    const video = this.video;
    const doc = video.ownerDocument as Document | undefined;
    if (!doc?.querySelector) return video.getAttribute?.('title') || video.title || null;
    const candidates: GenericTitleCandidates = {
      element: video.getAttribute('title'),
      labelledBy: labelElements(video).map((el) => el.textContent).join(' '),
      videoObjects: [],
      openGraph: null,
      twitter: null,
      document: null,
      siteName: null,
      heading: null
    };
    if (this.pageMetadata) {
      candidates.videoObjects = [...this.readJsonLd(doc), ...microdataVideoObjects(doc, video)];
      candidates.openGraph = metaContent(doc, 'meta[property="og:title"]');
      candidates.twitter = metaContent(doc, 'meta[name="twitter:title"]');
      candidates.document = doc.querySelector('title')?.textContent ?? null;
      candidates.siteName = metaContent(doc, 'meta[property="og:site_name"]');
      candidates.heading = tiedHeading(video)?.textContent ?? null;
    }
    return this.tracker.select(candidates, this.mediaIdentity(doc));
  }

  /**
   * Calls `onChange` when a title source changes or new media loads. The
   * observed nodes are retargeted after each change, because pages replace
   * `<title>`, meta tags and headings during client-side navigation.
   * @returns Idempotent cleanup.
   */
  observe(onChange: () => void): () => void {
    const video = this.video;
    const doc = video.ownerDocument as Document | undefined;
    if (!doc || typeof MutationObserver === 'undefined' || !video.addEventListener) return () => {};
    let active = true;
    const connect = () => {
      observer.disconnect();
      observer.observe(video, { attributes: true, attributeFilter: ['title', 'aria-labelledby'] });
      for (const label of labelElements(video)) observer.observe(label, TEXT_CHANGES);
      if (!this.pageMetadata) return;
      if (doc.head) observer.observe(doc.head, { childList: true });
      const title = doc.querySelector('title');
      if (title) observer.observe(title, TEXT_CHANGES);
      for (const meta of doc.querySelectorAll(META_SELECTOR)) observer.observe(meta, { attributes: true, attributeFilter: ['content'] });
      for (const script of doc.querySelectorAll(JSON_LD_SELECTOR)) observer.observe(script, TEXT_CHANGES);
      const heading = tiedHeading(video);
      if (heading) observer.observe(heading, TEXT_CHANGES);
    };
    const changed = () => {
      if (!active) return;
      connect();
      onChange();
    };
    // Style and script insertions into <head> are frequent and cannot change the title.
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.target !== doc.head || [...record.addedNodes, ...record.removedNodes].some(isTitleNode))) changed();
    });
    // Some players replace the media under the same URL.
    video.addEventListener('loadedmetadata', changed);
    connect();
    return () => {
      if (!active) return;
      active = false;
      observer.disconnect();
      video.removeEventListener('loadedmetadata', changed);
    };
  }

  private mediaIdentity(doc: Document): MediaIdentity {
    const video = this.video;
    const sources = [video.currentSrc, video.src, ...Array.from(video.querySelectorAll('source'), (source) => source.src)];
    return { page: doc.URL, sources: sources.filter(Boolean) };
  }

  /** Parses JSON-LD only when the scripts' text changes. */
  private readJsonLd(doc: Document): VideoObjectCandidate[] {
    const texts = Array.from(doc.querySelectorAll(JSON_LD_SELECTOR), (script) => script.textContent || '');
    const text = texts.join('\n');
    if (text !== this.jsonLd.text) this.jsonLd = { text, objects: texts.flatMap(parseJsonLdVideoObjects) };
    return this.jsonLd.objects;
  }
}
