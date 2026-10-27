import type { ProviderCapabilities } from '../capability-types';

export const iqiyiCapabilities = {
  id: 'iqiyi',
  name: 'iQIYI',
  brandColors: ['#00CC36', '#000000'],
  noteKey: 'rteNoteIqiyi',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNoteIqiyi' },
    chapters: { status: 'conditional', noteKey: 'rteNoteIqiyi' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'no' },
    playlists: { status: 'conditional', noteKey: 'rteNoteIqiyi' },
    launcher: { status: 'no' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteIqiyi' },
    autoTheater: { status: 'yes' }
  }
} as const satisfies ProviderCapabilities;
