const SVG_NS = 'http://www.w3.org/2000/svg';
const TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const ATTRIBUTES = new Set([
  'viewBox', 'width', 'height', 'fill', 'fill-rule', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'd', 'points', 'x', 'y', 'x1', 'x2', 'y1', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'transform', 'class', 'data-level', 'data-side',
  'aria-hidden', 'focusable'
]);

/** Rebuild packaged icon shapes as nodes; never adopt parsed executable SVG. */
export function createSvgIcon(markup: string): SVGSVGElement {
  const parsed = new DOMParser().parseFromString(markup.trim(), 'image/svg+xml');
  function copy(source: Element): SVGElement {
    if (source.namespaceURI !== SVG_NS || !TAGS.has(source.localName)) throw new Error('Invalid icon shape');
    const element = document.createElementNS(SVG_NS, source.localName);
    for (const attribute of source.attributes) {
      if (!ATTRIBUTES.has(attribute.name)) continue;
      // Paint references cannot load external resources or reference host-page elements.
      if ((attribute.name === 'fill' || attribute.name === 'stroke')
        && !/^(none|currentColor|transparent|black|white|#[\da-f]{3,8})$/i.test(attribute.value)) throw new Error('Invalid icon paint');
      element.setAttribute(attribute.name, attribute.value);
    }
    for (const child of source.children) element.append(copy(child));
    return element;
  }
  const root = copy(parsed.documentElement);
  if (!(root instanceof SVGSVGElement)) throw new Error('Invalid icon root');
  return root;
}

/** Replace an icon button's content with a sanitized, decorative icon. */
export function setSvgIcon(element: HTMLElement, markup: string): void {
  const icon = createSvgIcon(markup);
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  element.replaceChildren(icon);
}
