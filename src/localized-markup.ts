/** Locale packs may supply copy and simple formatting, never executable DOM. */
export function localizedMarkup(message: string, owner: Document): DocumentFragment {
  const parsed = new DOMParser().parseFromString(message, 'text/html');
  const result = owner.createDocumentFragment();
  function copy(source: Node, target: Node): void {
    if (source.nodeType === Node.TEXT_NODE) {
      target.appendChild(owner.createTextNode(source.textContent ?? ''));
      return;
    }
    if (!(source instanceof Element) || source.namespaceURI !== 'http://www.w3.org/1999/xhtml') return;
    const tag = source.localName;
    if (tag !== 'a' && tag !== 'span') return;
    const element = owner.createElement(tag);
    if (tag === 'a') {
      const href = source.getAttribute('href') ?? '';
      // Only HTTPS destinations and local anchors are used by packaged messages.
      if (/^https:\/\//i.test(href) || /^#[\w-]+$/.test(href)) element.setAttribute('href', href);
      if (source.getAttribute('target') === '_blank') element.setAttribute('target', '_blank');
      if (source.hasAttribute('rel') || source.getAttribute('target') === '_blank') {
        element.setAttribute('rel', 'noopener noreferrer');
      }
    }
    if (tag === 'span' && source.getAttribute('class') === 'heart') element.className = 'heart';
    if (source.getAttribute('aria-hidden') === 'true') element.setAttribute('aria-hidden', 'true');
    for (const child of source.childNodes) copy(child, element);
    target.appendChild(element);
  }
  for (const child of parsed.body.childNodes) copy(child, result);
  return result;
}
