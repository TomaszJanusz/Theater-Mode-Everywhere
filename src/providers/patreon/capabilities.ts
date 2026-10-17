import type { ProviderCapabilities } from '../capability-types';

export const patreonCapabilities = {
  id: 'patreon',
  name: 'Patreon',
  brandColors: ['#F06352', '#F7F7F7', '#012B47'],
  noteKey: 'rteNotePatreon',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNotePatreon' },
    chapters: { status: 'conditional', noteKey: 'rteNotePatreon' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'conditional', noteKey: 'rteNotePatreon' },
    playlists: { status: 'no' },
    launcher: { status: 'no' },
    quickActions: { status: 'no' },
    autoTheater: { status: 'no' }
  }
} as const satisfies ProviderCapabilities;
