import type { ProviderCapabilities } from '../capability-types';

export const bilibiliCapabilities = {
  id: 'bilibili',
  name: 'Bilibili',
  brandColors: ['#06AEEC', '#FFFFFF'],
  noteKey: 'rteNoteBilibili',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNoteBilibili' },
    audio: { status: 'no' },
    chapters: { status: 'conditional', noteKey: 'rteNoteBilibili' },
    heatmap: { status: 'conditional', noteKey: 'rteNoteBilibili' },
    thumbnails: { status: 'conditional', noteKey: 'rteNoteBilibili' },
    playlists: { status: 'conditional', noteKey: 'rteNoteBilibili' },
    launcher: { status: 'no' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteBilibili' },
    autoTheater: { status: 'yes' }
  }
} as const satisfies ProviderCapabilities;
