/**
 * Netflix's title dialog computes `transform: matrix(1, 0, 0, 1, 0, 0)` from
 * `transform: scale(1)`. That identity matrix is a containing block for
 * `position: fixed`. The dialog also transitions `transform` for 533ms, so
 * `transform: none` alone leaves the matrix in place until the transition
 * ends. `transition: none` is what clears it in the same turn. `scale` was
 * already `none` on the measured dialog; it is still reset because a separate
 * scale property would be its own containing block.
 *
 * Containment uses mask-image longhands. Setting or removing the `mask`
 * shorthand drops an inline `mask-image` on the way out.
 */
export const NETFLIX_CONTAINMENT_VALUES: Record<string, string> = {
  transition: 'none',
  animation: 'none',
  transform: 'none',
  translate: 'none',
  rotate: 'none',
  scale: 'none',
  filter: 'none',
  'backdrop-filter': 'none',
  perspective: 'none',
  contain: 'none',
  'clip-path': 'none',
  'mask-image': 'none',
  '-webkit-mask-image': 'none',
  overflow: 'visible'
};

export type NetflixContainingStyle = {
  transform: string;
  scale: string;
  filter: string;
  backdropFilter: string;
  perspective: string;
  contain: string;
  willChange: string;
  mask: string;
};

export function computedStyleCreatesFixedContainingBlock(style: NetflixContainingStyle): boolean {
  if (style.transform && style.transform !== 'none') return true;
  if (style.scale && style.scale !== 'none') return true;
  if (style.filter && style.filter !== 'none') return true;
  if (style.backdropFilter && style.backdropFilter !== 'none') return true;
  if (style.perspective && style.perspective !== 'none') return true;
  if (style.contain && /paint|layout|strict|content|size/.test(style.contain)) return true;
  if (style.mask && style.mask !== 'none') return true;
  return /transform|filter|perspective|contain|mask/.test(style.willChange || '');
}

export function netflixOverflowClips(overflow: string): boolean {
  return /hidden|clip|auto|scroll/.test(overflow);
}

export function netflixContainmentProperties(skipOverflow: boolean): string[] {
  return Object.keys(NETFLIX_CONTAINMENT_VALUES).filter((property) => !(skipOverflow && property === 'overflow'));
}

type SavedInlineStyle = {
  property: string;
  value: string;
  priority: string;
};

const savedContainment = new Map<HTMLElement, SavedInlineStyle[]>();

function readContainingStyle(style: CSSStyleDeclaration): NetflixContainingStyle {
  return {
    transform: style.transform,
    scale: style.scale,
    filter: style.filter,
    backdropFilter: style.backdropFilter,
    perspective: style.perspective,
    contain: style.contain,
    willChange: style.willChange,
    mask: style.maskImage && style.maskImage !== 'none' ? style.maskImage : style.webkitMaskImage
  };
}

function remember(element: HTMLElement, properties: string[]): void {
  const saved = savedContainment.get(element) || [];
  for (const property of properties) {
    if (saved.some((item) => item.property === property)) continue;
    saved.push({
      property,
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property)
    });
  }
  savedContainment.set(element, saved);
}

function applyContainment(element: HTMLElement, skipOverflow: boolean): void {
  const properties = netflixContainmentProperties(skipOverflow);
  remember(element, properties);
  for (const property of properties) {
    element.style.setProperty(property, NETFLIX_CONTAINMENT_VALUES[property], 'important');
  }
}

function restoreElement(element: HTMLElement): void {
  const saved = savedContainment.get(element);
  if (!saved) return;
  for (const { property, value, priority } of saved) {
    if (value) element.style.setProperty(property, value, priority);
    else element.style.removeProperty(property);
  }
  savedContainment.delete(element);
}

export function holdNetflixViewport(video: HTMLElement): void {
  const seen = new Set<HTMLElement>();
  let node = video.parentElement;
  while (node && node !== document.documentElement) {
    const computed = getComputedStyle(node);
    const structural = node.classList.contains('nf-player-container')
      || node.classList.contains('sizing-wrapper')
      || node.classList.contains('VideoContainer')
      || node.getAttribute('role') === 'dialog'
      || computed.position === 'fixed';
    const skipOverflow = node === document.body;
    if (structural
      || computedStyleCreatesFixedContainingBlock(readContainingStyle(computed))
      || (!skipOverflow && netflixOverflowClips(computed.overflow))) {
      applyContainment(node, skipOverflow);
    }
    if (computed.position === 'fixed') {
      remember(node, ['background-color']);
      node.style.setProperty('background-color', '#000000', 'important');
    }
    seen.add(node);
    node = node.parentElement;
  }
  for (const element of [...savedContainment.keys()]) {
    if (!seen.has(element)) restoreElement(element);
  }
}

export function releaseNetflixViewport(): void {
  for (const element of [...savedContainment.keys()]) restoreElement(element);
}
