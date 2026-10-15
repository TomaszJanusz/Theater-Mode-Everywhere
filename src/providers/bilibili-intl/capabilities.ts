import type { ProviderCapabilities } from '../capability-types';

export const bilibiliIntlCapabilities = {
  id: 'bilibiliIntl',
  name: 'Bilibili.tv',
  brandColors: ['#06AEEC', '#FFFFFF'],
  noteKey: 'rteNoteBilibiliIntl',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNoteBilibiliIntl' },
    chapters: { status: 'conditional', noteKey: 'rteNoteBilibiliIntl' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'conditional', noteKey: 'rteNoteBilibiliIntl' },
    playlists: { status: 'conditional', noteKey: 'rteNoteBilibiliIntl' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteBilibiliIntl' },
  }
} as const satisfies ProviderCapabilities;
