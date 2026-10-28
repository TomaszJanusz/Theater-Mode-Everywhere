import type { ProviderCapabilities } from '../capability-types';

export const vikiCapabilities = {
  id: 'viki',
  name: 'Rakuten Viki',
  brandColors: ['#0C9BFF', '#1A1A1A'],
  noteKey: 'rteNoteViki',
  capabilities: {
    // The adapter names no title: the chip comes from the page's own metadata (og:title, <title>).
    title: { status: 'conditional', noteKey: 'rteNoteViki' },
    subtitles: { status: 'conditional', noteKey: 'rteNoteViki' },
    // Only episodes dubbed by Viki list more than one track; the audio menu is Viki's own.
    audio: { status: 'conditional', noteKey: 'rteNoteAudioTracks' },
    chapters: { status: 'conditional', noteKey: 'rteNoteViki' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'conditional', noteKey: 'rteNoteViki' },
    playlists: { status: 'conditional', noteKey: 'rteNoteViki' },
    launcher: { status: 'no' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteViki' },
    autoTheater: { status: 'yes' }
  }
} as const satisfies ProviderCapabilities;
