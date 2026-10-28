import type { ProviderCapabilities } from '../capability-types';

export const soopCapabilities = {
  id: 'soop',
  name: 'SOOP',
  brandColors: ['#0099FF', '#00D0FF', '#000000'],
  noteKey: 'rteNoteSoop',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'no' },
    audio: { status: 'no' },
    chapters: { status: 'conditional', noteKey: 'rteNoteSoop' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'no' },
    playlists: { status: 'conditional', noteKey: 'rteNoteSoop' },
    launcher: { status: 'no' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteSoop' },
    autoTheater: { status: 'yes' }
  }
} as const satisfies ProviderCapabilities;
