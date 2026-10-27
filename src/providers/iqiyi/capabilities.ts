import type { ProviderCapabilities } from '../capability-types';

export const iqiyiCapabilities = {
  id: 'iqiyi',
  name: 'iQIYI',
  brandColors: ['#00CC36', '#000000'],
  noteKey: 'rteNoteIqiyi',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'no' },
    chapters: { status: 'no' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'no' },
    playlists: { status: 'conditional', noteKey: 'rteNoteIqiyi' },
    launcher: { status: 'no' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteIqiyi' },
    autoTheater: { status: 'no' }
  }
} as const satisfies ProviderCapabilities;
