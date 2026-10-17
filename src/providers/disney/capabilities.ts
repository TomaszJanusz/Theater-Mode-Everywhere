import type { ProviderCapabilities } from '../capability-types';

export const disneyCapabilities = {
  id: 'disney',
  name: 'Disney+',
  brandColors: ['#091C2A', '#2EB3BF', '#186A7C'],
  noteKey: 'rteNoteDisney',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNoteDisney' },
    chapters: { status: 'no' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'conditional', noteKey: 'rteNoteDisney' },
    playlists: { status: 'conditional', noteKey: 'rteNoteDisney' },
    launcher: { status: 'no' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteDisney' },
    autoTheater: { status: 'yes' }
  }
} as const satisfies ProviderCapabilities;
