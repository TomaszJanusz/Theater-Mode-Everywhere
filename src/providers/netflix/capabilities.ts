import type { ProviderCapabilities } from '../capability-types';

export const netflixCapabilities = {
  id: 'netflix',
  name: 'Netflix',
  brandColors: ['#E50914', '#B20710', '#141414', '#1F1F1F'],
  noteKey: 'rteNoteNetflix',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNoteNetflix' },
    audio: { status: 'no' },
    chapters: { status: 'no' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'conditional', noteKey: 'rteNoteNetflix' },
    playlists: { status: 'conditional', noteKey: 'rteNoteNetflix' },
    launcher: { status: 'no' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteNetflix' },
    autoTheater: { status: 'yes' }
  }
} as const satisfies ProviderCapabilities;
