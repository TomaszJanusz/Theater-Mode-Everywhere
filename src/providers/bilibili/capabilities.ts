import type { ProviderCapabilities } from '../capability-types';

export const bilibiliCapabilities = {
  id: 'bilibili',
  name: 'Bilibili',
  brandColors: ['#06AEEC', '#FFFFFF'],
  noteKey: 'rteNoteBilibili',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNoteBilibili' },
    chapters: { status: 'conditional', noteKey: 'rteNoteBilibili' },
    heatmap: { status: 'conditional', noteKey: 'rteNoteBilibili' },
    thumbnails: { status: 'conditional', noteKey: 'rteNoteBilibili' },
    playlists: { status: 'conditional', noteKey: 'rteNoteBilibili' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteBilibili' },
  }
} as const satisfies ProviderCapabilities;
