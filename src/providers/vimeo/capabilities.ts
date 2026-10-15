import type { ProviderCapabilities } from '../capability-types';

export const vimeoCapabilities = {
  id: 'vimeo',
  name: 'Vimeo',
  // Reviewed 2026-10-15: https://vimeo.com/press/media-kit (current official #17D5FF / #141A20 / #FAFCFD supersede older blue/navy).
  brand: {
    primary: '#17D5FF',
    secondary: '#141A20',
    extra: ['#FAFCFD'],
    // UI-only border tints: 55% mix reaches 3:1 on the dark surface, including interpolation.
    uiBorder: ['#5FE2FF', '#D0D1D2', '#FAFCFD'],
    uiAccent: '#17D5FF',
  },
  noteKey: 'rteNoteVimeo',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'no' },
    chapters: { status: 'conditional', noteKey: 'rteNoteVimeo' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'conditional', noteKey: 'rteNoteVimeo' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteVimeo' },
  }
} as const satisfies ProviderCapabilities;
