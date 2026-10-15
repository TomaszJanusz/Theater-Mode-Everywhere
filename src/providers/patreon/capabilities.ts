import type { ProviderCapabilities } from '../capability-types';

export const patreonCapabilities = {
  id: 'patreon',
  name: 'Patreon',
  // Reviewed 2026-10-15: https://www.patreon.com/brand ; https://brandcolors.net/b/patreon (legacy coral/navy; current official assets are black/white).
  // Retain the approved recognizable legacy palette; navy is not verified in the current official kit.
  brand: {
    primary: '#FF424D',
    secondary: '#052D49',
    extra: ['#FFFFFF'],
    // UI-only border tints: 55% mix reaches 3:1 on the dark surface, including interpolation.
    uiBorder: ['#FFB7BB', '#C3CDD3', '#FFFFFF'],
    uiAccent: '#FF424D',
  },
  noteKey: 'rteNotePatreon',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNotePatreon' },
    chapters: { status: 'conditional', noteKey: 'rteNotePatreon' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'conditional', noteKey: 'rteNotePatreon' },
    quickActions: { status: 'no' },
  }
} as const satisfies ProviderCapabilities;
