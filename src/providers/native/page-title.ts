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

type HeadingContext = { headings: HTMLHeadingElement[]; composite: boolean };

function headingContext(anchor: Element, allowPair = false): HeadingContext {
  const doc = anchor.ownerDocument;
  const headings = Array.from(doc.querySelectorAll('h1'));
  if (headings.length === 0) return { headings: [], composite: false };
  for (let node = anchor.parentElement; node && node !== doc.documentElement; node = node.parentElement) {
    if (node === doc.body && !allowPair) break;
    const inside = headings.filter((heading) => node.contains(heading));
    if (inside.length === 0) continue;
    if (node.querySelectorAll(allowPair ? 'video, iframe' : 'video').length !== 1) break;
    if (inside.length === 1 && node !== doc.body) return { headings: inside, composite: false };
    // Two adjacent H1s beside a single embedded player can supply series + episode.
    // Requiring sibling headings avoids combining unrelated page sections.
    if (allowPair && inside.length === 2 && inside[0].nextElementSibling === inside[1]) {
      return { headings: inside, composite: true };
    }
    break;
  }
  return { headings: [], composite: false };
}

function parentContext(doc: Document): { doc: Document; frame: Element } | null {
  try {
    const view = doc.defaultView;
    if (!view || view.parent === view) return null;
    const parentDoc = view.parent.document;
    const frame = view.frameElement;
    return frame && frame.ownerDocument === parentDoc ? { doc: parentDoc, frame } : null;
  } catch {
    // A cross-origin or sandboxed parent is intentionally unavailable.
    return null;
  }
}

/** Properties owned by this item, not by an item nested inside it. */
function microdataProp(scope: Element, name: string): Element[] {
  return Array.from(scope.querySelectorAll(`[itemprop~="${name}"]`))
    .filter((el) => el.parentElement?.closest('[itemscope]') === scope);
}

function microdataValue(el: Element): string | null {
  return el.getAttribute('content') || el.getAttribute('href') || el.getAttribute('src') || el.textContent;
}

function microdataVideoObjects(doc: Document, video: Element): VideoObjectCandidate[] {
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
  private documents = new WeakMap<Document, { tracker: GenericTitleTracker; text: string; objects: VideoObjectCandidate[] }>();

  constructor(private video: HTMLVideoElement, private pageMetadata: boolean) {}

  read(): string | null {
    const video = this.video;
    const doc = video.ownerDocument as Document | undefined;
    if (!doc?.querySelector) return video.getAttribute?.('title') || video.title || null;
    if (!video.isConnected) return null;
    const own = this.readDocument(doc, video, false);
    const parent = this.pageMetadata ? parentContext(doc) : null;
    // Keep each document's URL history independent, even while an element label wins.
    const fallback = parent ? this.readDocument(parent.doc, parent.frame, true) : null;
    return own || fallback;
  }

  private readDocument(doc: Document, anchor: Element, embedded: boolean): string | null {
    let state = this.documents.get(doc);
    if (!state) {
      state = { tracker: new GenericTitleTracker(), text: '', objects: [] };
      this.documents.set(doc, state);
    }
    const candidates: GenericTitleCandidates = {
      element: embedded ? null : this.video.getAttribute('title'),
      labelledBy: embedded ? null : labelElements(this.video).map((el) => el.textContent).join(' '),
      videoObjects: [],
      openGraph: null,
      twitter: null,
      document: null,
      siteName: null,
      heading: null
    };
    if (this.pageMetadata) {
      const texts = Array.from(doc.querySelectorAll(JSON_LD_SELECTOR), (script) => script.textContent || '');
      const text = texts.join('\n');
      if (text !== state.text) {
        state.text = text;
        state.objects = texts.flatMap(parseJsonLdVideoObjects);
      }
      candidates.videoObjects = [...state.objects, ...microdataVideoObjects(doc, anchor)];
      candidates.openGraph = metaContent(doc, 'meta[property="og:title"]');
      candidates.twitter = metaContent(doc, 'meta[name="twitter:title"]');
      candidates.document = doc.querySelector('title')?.textContent ?? null;
      candidates.siteName = metaContent(doc, 'meta[property="og:site_name"]');
      const context = headingContext(anchor, embedded);
      candidates.heading = context.headings.map((heading) => heading.textContent).join(' ');
      candidates.headingBeforeDocument = context.composite;
    }
    return state.tracker.select(candidates, this.mediaIdentity(doc));
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
    const structuralTargets = new Set<Node>();
    const connect = () => {
      observer.disconnect();
      structuralTargets.clear();
      observer.observe(video, { attributes: true, attributeFilter: ['title', 'aria-labelledby'] });
      for (const label of labelElements(video)) observer.observe(label, TEXT_CHANGES);
      if (!this.pageMetadata) return;
      const observeDocument = (document: Document, anchor: Element, embedded: boolean) => {
        if (document.head) {
          structuralTargets.add(document.head);
          observer.observe(document.head, { childList: true });
        }
        const title = document.querySelector('title');
        if (title) observer.observe(title, TEXT_CHANGES);
        for (const meta of document.querySelectorAll(META_SELECTOR)) observer.observe(meta, { attributes: true, attributeFilter: ['content'] });
        for (const script of document.querySelectorAll(JSON_LD_SELECTOR)) observer.observe(script, TEXT_CHANGES);
        for (const heading of headingContext(anchor, embedded).headings) {
          observer.observe(heading, TEXT_CHANGES);
          if (heading.parentElement) {
            structuralTargets.add(heading.parentElement);
            observer.observe(heading.parentElement, { childList: true });
          }
        }
      };
      observeDocument(doc, video, false);
      const parent = parentContext(doc);
      if (parent) observeDocument(parent.doc, parent.frame, true);
    };
    const changed = () => {
      if (!active) return;
      connect();
      onChange();
    };
    // Style and script insertions into <head> are frequent and cannot change the title.
    const observer = new MutationObserver((records) => {
      if (records.some((record) => !structuralTargets.has(record.target)
        || [...record.addedNodes, ...record.removedNodes].some((node) => isTitleNode(node) || node.nodeName === 'H1'))) changed();
    });
    // Some players replace the media under the same URL.
    video.addEventListener('loadedmetadata', changed);
    const views = [doc.defaultView, this.pageMetadata ? parentContext(doc)?.doc.defaultView : null];
    for (const view of views) {
      view?.addEventListener('popstate', changed);
      view?.addEventListener('hashchange', changed);
    }
    connect();
    return () => {
      if (!active) return;
      active = false;
      observer.disconnect();
      video.removeEventListener('loadedmetadata', changed);
      for (const view of views) {
        view?.removeEventListener('popstate', changed);
        view?.removeEventListener('hashchange', changed);
      }
    };
  }

  private mediaIdentity(doc: Document): MediaIdentity {
    const video = this.video;
    const sources = [video.currentSrc, video.src, ...Array.from(video.querySelectorAll('source'), (source) => source.src)];
    return { page: doc.URL, sources: sources.filter(Boolean), embedPage: video.ownerDocument.URL };
  }
}
