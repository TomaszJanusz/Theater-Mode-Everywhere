import type { ProviderCapabilities } from '../capability-types';

export const netflixCapabilities = {
  id: 'netflix',
  name: 'Netflix',
  // Reviewed 2026-10-15: https://brand.netflix.com/en/assets/logos/ (red/black); burgundy is a UI interpretation, not an official swatch.
  brand: {
    primary: '#E50914',
    secondary: '#000000',
    tile: ['#0B0B0B', '#141414', '#5C0A12'],
    // 28 evenly spaced column centers at y=180 in the supplied 480x360 title-card PNG; raw sRGB samples.
    stripes: ['#2B0304', '#C02223', '#DB654B', '#BC094D', '#1E0009', '#520704', '#96011F', '#FD929C', '#B7072E', '#5F011C', '#3E0202', '#B2003E', '#A30830', '#EC458D', '#A1001F', '#A0044B', '#B047E2', '#381883', '#0B0048', '#AF6BF4', '#11031A', '#4137E6', '#82A9F6', '#5BFFFE', '#2B36E6', '#053CB0', '#000075', '#206EF6'],
    // UI-only border tints: 55% mix reaches 3:1 on the dark surface, including interpolation.
    uiBorder: ['#F6ABAF', '#BFBFBF'],
    uiAccent: '#E50914',
  },
  noteKey: 'rteNoteNetflix',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNoteNetflix' },
    chapters: { status: 'no' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'conditional', noteKey: 'rteNoteNetflix' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteNetflix' },
  }
} as const satisfies ProviderCapabilities;
