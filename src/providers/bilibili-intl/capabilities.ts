import type { ProviderCapabilities } from '../capability-types';

export const bilibiliIntlCapabilities = {
  id: 'bilibiliIntl',
  name: 'Bilibili.tv',
  brandColors: ['#06AEEC', '#FFFFFF'],
  noteKey: 'rteNoteBilibiliIntl',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNoteBilibiliIntl' },
    audio: { status: 'no' },
    chapters: { status: 'conditional', noteKey: 'rteNoteBilibiliIntl' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'conditional', noteKey: 'rteNoteBilibiliIntl' },
    playlists: { status: 'conditional', noteKey: 'rteNoteBilibiliIntl' },
    launcher: { status: 'no' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteBilibiliIntl' },
    autoTheater: { status: 'yes' }
  }
} as const satisfies ProviderCapabilities;
