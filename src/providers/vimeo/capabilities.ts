import type { ProviderCapabilities } from '../capability-types';

export const vimeoCapabilities = {
  id: 'vimeo',
  name: 'Vimeo',
  brandColors: ['#15D5FF', '#141A20'],
  noteKey: 'rteNoteVimeo',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'no' },
    chapters: { status: 'conditional', noteKey: 'rteNoteVimeo' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'conditional', noteKey: 'rteNoteVimeo' },
    playlists: { status: 'conditional', noteKey: 'rteNoteVimeo' },
    launcher: { status: 'no' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteVimeo' },
    autoTheater: { status: 'yes' }
  }
} as const satisfies ProviderCapabilities;
