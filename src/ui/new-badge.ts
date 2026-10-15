import { t } from './messages';

export type NewBadgeVariant = 'pill' | 'dot';
const TAG = 'te-new-badge';

export const NEW_BADGE_CSS = `
.te-new-badge {
  display: inline-flex; align-items: center; flex: 0 0 auto;
  vertical-align: middle; pointer-events: none;
  font: 800 9.5px/1 system-ui, sans-serif; letter-spacing: .07em;
  text-transform: uppercase; white-space: nowrap;
  color: color-mix(in srgb, var(--accent-color) 55%, #fff);
  background: color-mix(in srgb, var(--accent-color) 18%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-color) 55%, transparent);
  border-radius: 999px; padding: 3px 7px; margin-inline-start: 8px;
}
.te-new-badge[data-variant="dot"] {
  position: absolute; inset-block-start: var(--new-badge-inset-block-start, 2px); inset-inline-end: var(--new-badge-inset-inline-end, 2px);
  width: 8px; height: 8px; box-sizing: content-box;
  padding: 0; margin: 0; border: 0; border-radius: 50%;
  background: var(--accent-color);
  box-shadow: 0 0 0 2px var(--new-badge-surrounding-color, var(--bg-color, #141414));
}
`;

export function ensureNewBadgeStyles(root: Document | ShadowRoot): void {
  if (root.querySelector('#te-new-badge-styles')) return;
  const style = document.createElement('style');
  style.id = 'te-new-badge-styles';
  style.textContent = NEW_BADGE_CSS;
  (root instanceof Document ? root.head : root).append(style);
}

function renderBadge(badge: HTMLElement, variant: NewBadgeVariant): void {
  badge.className = 'te-new-badge';
  badge.dataset.variant = variant;
  badge.textContent = variant === 'pill' ? t('badgeNew') : '';
  if (variant === 'dot') badge.setAttribute('aria-hidden', 'true');
  else badge.removeAttribute('aria-hidden');
}

/** Content-script registries can be null (Chromium isolated world). Settings opts in. */
export function defineNewBadge(): void {
  if (!globalThis.customElements || customElements.get(TAG)) return;
  customElements.define(TAG, class extends HTMLElement {
    connectedCallback() { renderBadge(this, this.dataset.variant === 'dot' ? 'dot' : 'pill'); }
  });
}

export function createNewBadge(variant: NewBadgeVariant = 'pill'): HTMLElement {
  const badge = document.createElement(globalThis.customElements?.get(TAG) ? TAG : 'span');
  renderBadge(badge, variant);
  return badge;
}
