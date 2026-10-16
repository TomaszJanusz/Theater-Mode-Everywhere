import type { ProviderCapabilities } from '../capability-types';

export const youtubeCapabilities = {
  id: 'youtube',
  name: 'YouTube',
  brandColors: ['#F70000', '#EAEAEA'],
  noteKey: 'rteNoteYoutube',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNoteYoutube' },
    chapters: { status: 'conditional', noteKey: 'rteNoteYoutube' },
    heatmap: { status: 'conditional', noteKey: 'rteNoteYoutube' },
    thumbnails: { status: 'conditional', noteKey: 'rteNoteYoutube' },
    playlists: { status: 'conditional', noteKey: 'rteNoteYoutube' },
    launcher: { status: 'conditional', noteKey: 'rteNoteLauncher' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteYoutube' },
  }
} as const satisfies ProviderCapabilities;
