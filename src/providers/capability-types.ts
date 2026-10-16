import type { MediaProviderId } from '../media-features/provider-flags';

export const MEDIA_CAPABILITIES = ['title', 'subtitles', 'chapters', 'heatmap', 'thumbnails', 'playlists', 'quickActions'] as const;
export type MediaCapability = (typeof MEDIA_CAPABILITIES)[number];
export type CapabilitySupport = { status: 'yes' | 'no' } | { status: 'conditional'; noteKey: string };

/** Pure metadata: importing this contract must never load player or adapter code. */
export interface ProviderCapabilities {
  id: MediaProviderId;
  name: string;
  /** Brand palette in its listed order; the options page derives tile roles from it. */
  brandColors: readonly string[];
  noteKey?: string;
  capabilities: Record<MediaCapability, CapabilitySupport>;
}
