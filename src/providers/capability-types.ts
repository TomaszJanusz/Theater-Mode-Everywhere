import type { MediaProviderId } from '../media-features/provider-flags';

export const MEDIA_CAPABILITIES = ['title', 'subtitles', 'chapters', 'heatmap', 'thumbnails', 'quickActions'] as const;
export type MediaCapability = (typeof MEDIA_CAPABILITIES)[number];
export type CapabilitySupport = { status: 'yes' | 'no' } | { status: 'conditional'; noteKey: string };

/** Pure metadata: importing this contract must never load player or adapter code. */
export interface ProviderCapabilities {
  id: MediaProviderId;
  name: string;
  brand: {
    primary: string;
    secondary?: string;
    extra?: readonly string[];
    tile?: readonly string[];
    stripes?: readonly string[];
    decoration?: 'arc';
    uiAccent: string;
    uiBorder: readonly string[];
  };
  noteKey?: string;
  capabilities: Record<MediaCapability, CapabilitySupport>;
}
