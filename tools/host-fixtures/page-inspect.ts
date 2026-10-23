import type { Signature } from './format';

/**
 * Code that runs inside a page (the live host, or a rendered fixture). Each function is
 * serialized with `toString()`, so it may only use its arguments, the DOM and `readSignature`
 * (which the scripts below define next to it).
 */
export interface RawNode { tag: string; attrs: Record<string, string>; style: string; children: RawNode[] }
export interface InspectOptions {
  probes: Record<string, string>;
  /** Element descendants kept below each probe match. */
  keepDepth: number;
  /** Children kept per node when expanding below a match. */
  maxChildren: number;
  /** Attribute names collected; their values are sanitized afterwards, outside the page. */
  attributes: readonly string[];
}
export interface PageInspection {
  dom: RawNode;
  signature: Signature;
  /** Strings that identify the page (URL path, query values, title parts), scrubbed from every value. */
  identifying: string[];
}

/** The provider-relevant facts of the probes (see `ProbeState`); identical for a live page and its rendered fixture. */
export function readSignature(probes: Record<string, string>): Signature {
  const first = new Map<string, Element | null>();
  const signature: Signature = {};
  for (const [name, selector] of Object.entries(probes)) {
    const matches = document.querySelectorAll(selector);
    first.set(name, matches[0] ?? null);
    const element = matches[0];
    const rect = element?.getBoundingClientRect();
    const transform = element ? getComputedStyle(element).transform : 'none';
    signature[name] = {
      count: Math.min(matches.length, 2) as 0 | 1 | 2,
      rendered: Boolean(rect && rect.width > 0 && rect.height > 0),
      transformed: transform !== 'none' && transform !== '',
      within: []
    };
  }
  for (const [name, element] of first) {
    if (!element) continue;
    signature[name].within = [...first].filter(([other, node]) => other !== name && node && node !== element && node.contains(element)).map(([other]) => other).sort();
  }
  return signature;
}

const SKIPPED_TAGS = ['script', 'style', 'link', 'meta', 'noscript', 'template', 'head', 'title', 'base'];

/** Trims the document to the probes, their ancestors and a few descendants, with layout inlined. */
export function inspectHostPage(options: InspectOptions): PageInspection {
  const keep = new Set<Element>();
  const expand = new Map<Element, number>();
  for (const selector of Object.values(options.probes)) {
    for (const match of [...document.querySelectorAll(selector)].slice(0, 3)) {
      expand.set(match, Math.max(expand.get(match) ?? 0, options.keepDepth));
      for (let node: Element | null = match; node && node !== document.documentElement; node = node.parentElement) keep.add(node);
    }
  }
  // The extension's own nodes are not host structure.
  const ours = (element: Element): boolean => /^theater-/.test(element.id) || [...element.classList].some(name => name.startsWith('theater-'));
  const styleOf = (element: Element): string => {
    const style = getComputedStyle(element);
    const parts = [`display:${style.display}`];
    if (style.position !== 'static') {
      parts.push(`position:${style.position}`);
      for (const side of ['top', 'left'] as const) if (style[side] !== 'auto') parts.push(`${side}:${style[side]}`);
    }
    const box = element instanceof HTMLElement ? { width: element.offsetWidth, height: element.offsetHeight } : element.getBoundingClientRect();
    parts.push(`width:${Math.round(box.width)}px`, `height:${Math.round(box.height)}px`);
    if (style.transform !== 'none') parts.push(`transform:${style.transform}`);
    if (style.visibility !== 'visible') parts.push(`visibility:${style.visibility}`);
    if (style.opacity !== '1') parts.push(`opacity:${style.opacity}`);
    if (style.display.includes('flex')) parts.push(`flex-direction:${style.flexDirection}`);
    if (style.overflow === 'hidden') parts.push('overflow:hidden');
    return parts.join(';');
  };
  const serialize = (element: Element, depth: number): RawNode => {
    const attrs: Record<string, string> = {};
    for (const name of options.attributes) {
      const value = element.getAttribute(name);
      if (value !== null) attrs[name] = value;
    }
    const tag = element.tagName.toLowerCase();
    const children: RawNode[] = [];
    // SVG content is artwork (logos, icons), not structure.
    if (tag !== 'svg') {
      let extra = 0;
      for (const child of element.children) {
        const tagName = child.tagName.toLowerCase();
        if (SKIPPED_TAGS.includes(tagName) || ours(child)) continue;
        const own = expand.get(child);
        if (keep.has(child)) children.push(serialize(child, own ?? Math.max(depth - 1, 0)));
        else if (depth > 0 && extra < options.maxChildren) { extra += 1; children.push(serialize(child, depth - 1)); }
      }
    }
    return { tag, attrs, style: styleOf(element), children };
  };
  const query = new URLSearchParams(location.search);
  const titleParts = [document.title, document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? '']
    .flatMap(title => title.split(/ [-|•·–—] /));
  const identifying = [...location.pathname.split('/'), ...query.values(), ...titleParts].map(part => part.trim()).filter(part => part.length >= 3);
  return { dom: serialize(document.body, 0), signature: readSignature(options.probes), identifying: [...new Set(identifying)] };
}

// Scripts for `page.evaluate`: tsx wraps named functions in `__name()`, which a page lacks.
const script = (entry: string, argument: unknown): string =>
  `(() => { globalThis.__name = target => target; const readSignature = ${readSignature.toString()}; const SKIPPED_TAGS = ${JSON.stringify(SKIPPED_TAGS)}; return (${entry})(${JSON.stringify(argument)}); })()`;
export const inspectScript = (options: InspectOptions): string => script(inspectHostPage.toString(), options);
export const signatureScript = (probes: Record<string, string>): string => script('readSignature', probes);
