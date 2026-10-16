import { mediaProviderIntegrationEnabled } from '../media-features/provider-flags';
import { PROVIDER_DEFINITIONS } from './registry';

/** A native slot is optional; null always falls back to the generic overlay. */
export type LauncherSlot = {
  before: HTMLElement;
  mount(button: HTMLButtonElement): void;
};

export type LauncherPlacement = {
  /** Revalidate the current player, video and insertion anchor on every read. */
  read(): LauncherSlot | null;
  dispose(): void;
};

export type LauncherPlacementFactory = (video: HTMLVideoElement, onChange: () => void) => LauncherPlacement;

export function createProviderLauncherPlacement(video: HTMLVideoElement, onChange: () => void): LauncherPlacement | null {
  const provider = PROVIDER_DEFINITIONS.find(definition => definition.id !== 'native'
    && definition.matchesHost(location.hostname) && mediaProviderIntegrationEnabled(definition.id)
    && definition.launcherPlacement);
  return provider?.launcherPlacement?.(video, onChange) ?? null;
}
