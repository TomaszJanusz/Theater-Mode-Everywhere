import type { ProviderCapabilities } from '../capability-types';

export const youtubeCapabilities = {
  id: 'youtube',
  name: 'YouTube',
  // Reviewed 2026-10-15: https://cdn.jsdelivr.net/npm/simple-icons@latest/data/simple-icons.json ; https://brand.youtube/ (red from Simple Icons, white counterpart).
  brand: {
    primary: '#FF0000',
    secondary: '#FFFFFF',
    // UI-only border tints: 55% mix reaches 3:1 on the dark surface, including interpolation.
    uiBorder: ['#FFB8B8', '#FFFFFF'],
    uiAccent: '#FF0000',
  },
  noteKey: 'rteNoteYoutube',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNoteYoutube' },
    chapters: { status: 'conditional', noteKey: 'rteNoteYoutube' },
    heatmap: { status: 'conditional', noteKey: 'rteNoteYoutube' },
    thumbnails: { status: 'conditional', noteKey: 'rteNoteYoutube' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteYoutube' },
  }
} as const satisfies ProviderCapabilities;
