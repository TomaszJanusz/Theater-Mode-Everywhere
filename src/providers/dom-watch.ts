import type { FrameMeasure } from '../core/frame-batch';
import { createVisibleRefresh } from '../core/visible-refresh';

const EVENTS = ['DOMContentLoaded', 'readystatechange', 'popstate', 'resize', 'loadedmetadata', 'emptied', 'durationchange', 'play', 'pause', 'seeked', 'ended'];

/** Providers choose observed surfaces; discovery only examines changed subtrees. */
export function observeProviderDom(options: {
  root: Document | ShadowRoot;
  selector: string;
  /** Reads the changed surfaces in the frame's read phase; DOM writes it returns run after all reads. */
  changed: FrameMeasure;
  enabled?: () => boolean;
  relevant?: (record: MutationRecord) => boolean;
  ignore?: (record: MutationRecord) => boolean;
  /** Host events after which surfaces may have changed, such as SPA navigation. */
  events?: readonly string[];
  /** Root attributes whose flips re-discover the surfaces, such as a provider's integration-off flag. */
  flags?: readonly string[];
  pollWhenEmpty?: boolean;
  /**
   * The 1 Hz fallback only covers changes the observers cannot see. A provider that knows when
   * that can happen returns false otherwise, and the timer is not armed; defaults to always.
   */
  needsFallback?: () => boolean;
  structureChanged?: () => void;
}): () => void {
  const doc = options.root instanceof Document ? options.root : options.root.ownerDocument;
  let roots = new Set<Element>();
  let dirty = true;
  const shadowHosts = new Set<Element>();
  const observedShadows = new Set<ShadowRoot>();
  const enabled = () => options.enabled?.() !== false;
  const own = (node: Node) => {
    const element = node instanceof Element ? node : node.parentElement;
    if (element?.closest('#theater-everywhere-ui, [id^="theater-everywhere-"][hidden]')) return true;
    const root = element?.getRootNode();
    return root instanceof ShadowRoot && root.host.id === 'theater-everywhere-ui';
  };
  const ownedRecord = (record: MutationRecord) => {
    if (own(record.target) || options.ignore?.(record)) return true;
    const nodes = [...record.addedNodes, ...record.removedNodes];
    return record.type === 'childList' && nodes.length > 0 && nodes.every(own);
  };
  const surfaces = new MutationObserver(records => {
    const relevant = records.filter(record => !ownedRecord(record));
    if (relevant.some(record => record.type === 'childList'
      && [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element))) options.structureChanged?.();
    if (doc.hidden) { dirty = true; return; }
    for (const record of relevant) if (record.type === 'childList') {
      for (const node of record.addedNodes) attachShadows(node);
    }
    if ([...observedShadows].some(root => !root.host.isConnected)) dirty = true;
    if (relevant.some(record => options.relevant?.(record) !== false)) refresh.request();
  });
  const attachShadows = (node: Node) => {
    if (!(node instanceof Element) || own(node)) return;
    if (node.tagName.includes('-')) shadowHosts.add(node);
    if (node.shadowRoot) {
      attachShadow(node.shadowRoot);
    }
    for (const child of node.children) attachShadows(child);
  };
  const attachShadow = (root: ShadowRoot) => {
    if (observedShadows.has(root)) return;
    observedShadows.add(root);
    observe(root);
    options.structureChanged?.();
    for (const child of root.children) attachShadows(child);
  };
  const observe = (node: Node) => surfaces.observe(node, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'style', 'hidden', 'disabled', 'aria-disabled', 'aria-hidden', 'aria-label',
      'title', 'href', 'src', 'data-preview', 'data-tooltip-text', 'data-videoid', 'selected', 'collapsed'] });
  const discover = () => {
    if (doc.documentElement && flagsRoot !== doc.documentElement) {
      flagsRoot = doc.documentElement;
      flags.observe(flagsRoot, { attributes: true, attributeFilter: [...options.flags ?? []] });
    }
    if (!dirty && [...roots].every(root => root.isConnected)) {
      for (const host of shadowHosts) {
        if (!host.isConnected) shadowHosts.delete(host);
        else if (host.shadowRoot) attachShadow(host.shadowRoot);
      }
      return;
    }
    dirty = false;
    options.structureChanged?.();
    surfaces.disconnect();
    shadowHosts.clear();
    observedShadows.clear();
    roots = enabled() ? new Set(options.root.querySelectorAll(options.selector)) : new Set();
    for (const root of roots) { observe(root); attachShadows(root); }
  };
  const refresh = createVisibleRefresh(doc, () => {
    if (!enabled() && roots.size) dirty = true;
    discover();
    return options.changed();
  }, { active: () => enabled() && (roots.size > 0 || options.pollWhenEmpty === true) && options.needsFallback?.() !== false,
    events: [...EVENTS, ...options.events ?? []] });
  const containsRoot = (node: Node) => node instanceof Element && (node.matches(options.selector)
    || Boolean(node.querySelector(options.selector)));
  const discovery = new MutationObserver(records => {
    if (!enabled()) return;
    if (doc.hidden) { dirty = true; return; }
    if (records.some(record => !ownedRecord(record) && record.type === 'childList'
      && [...record.addedNodes, ...record.removedNodes].some(containsRoot))) {
      dirty = true;
      options.structureChanged?.();
      refresh.request();
    }
  });
  discovery.observe(options.root, { childList: true, subtree: true });
  let flagsRoot: HTMLElement | null = null;
  const flags = new MutationObserver(() => { dirty = true; refresh.request(); });
  refresh.refresh();
  return () => {
    refresh.dispose(); surfaces.disconnect(); discovery.disconnect(); flags.disconnect();
    roots.clear(); shadowHosts.clear(); observedShadows.clear();
    options.structureChanged?.();
  };
}
