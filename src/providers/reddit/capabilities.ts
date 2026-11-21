import type { ProviderCapabilities } from '../capability-types';

export const redditCapabilities = {
  id: 'reddit',
  name: 'Reddit',
  brandColors: ['#FF4500', '#FFFFFF', '#0B1416'],
  noteKey: 'rteNoteReddit',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNoteReddit' },
    audio: { status: 'no' },
    chapters: { status: 'no' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'no' },
    playlists: { status: 'no' },
    launcher: { status: 'no' },
    quickActions: { status: 'no' },
    autoTheater: { status: 'no' }
  }
} as const satisfies ProviderCapabilities;
