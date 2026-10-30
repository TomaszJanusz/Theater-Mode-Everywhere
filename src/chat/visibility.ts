/** Native semantic/display state and geometry; null means no measurable state. */
export function readNativeChatVisibility(root: HTMLElement): boolean | null {
  const view = root.ownerDocument.defaultView;
  if (!view) return null;
  // Theater suppresses unbound panels via visibility; native display and semantic flags remain readable.
  const theaterActive = root.ownerDocument.documentElement.classList.contains('theater-everywhere-html-active');
  for (let node: HTMLElement | null = root; node; node = node.parentElement) {
    if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
    const style = view.getComputedStyle(node);
    if (style.display === 'none') return false;
    if (!theaterActive && (style.visibility === 'hidden' || style.visibility === 'collapse')) return false;
  }
  const width = root.getBoundingClientRect().width;
  if (width > 0) return true;
  return (root.parentElement?.getBoundingClientRect().width ?? 0) > 0 ? false : null;
}
