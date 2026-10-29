import { mediaProviderIntegrationEnabled } from '../../media-features/provider-flags';
import { isVikiHost } from '../hosts';
import { collectElement, type CollectedControl } from '../playlist-controls';

/**
 * Viki's Video.js control bar names its buttons only by localized text, so the
 * next-episode step is found by its icon. It has no previous-episode control.
 */
export function readVikiControls(root: ParentNode): CollectedControl[] {
  if (!isVikiHost() || !mediaProviderIntegrationEnabled('viki')) return [];
  const button = root.querySelector('button.vjs-control > .vjs-icon-next-item')?.parentElement;
  return button instanceof HTMLElement
    ? [collectElement(button, 'viki', 'next', () => ({ preview: null, restarts: false }))]
    : [];
}
