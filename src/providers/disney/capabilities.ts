import type { ProviderCapabilities } from '../capability-types';

export const disneyCapabilities = {
  id: 'disney',
  name: 'Disney+',
  // Reviewed 2026-10-15: https://press.disneyplus.com/about/disney-plus-logo-2024 ; https://fliphtml5.com/mxrjn/yyfa/Disney_%2B_Brand_Book/ (legacy blue).
  // Approved legacy blue retained; #0A6CFF is a UI companion, not a verified current brand swatch (2024 branding is teal).
  brand: {
    primary: '#113CCF',
    secondary: '#0A6CFF',
    decoration: 'arc',
    // UI-only border tints: 55% mix reaches 3:1 on the dark surface, including interpolation.
    uiBorder: ['#ACBBEE', '#93BEFF'],
    // Lighten the primary only for UI track/focus contrast (at least 3:1).
    uiAccent: '#4F6FDB',
  },
  noteKey: 'rteNoteDisney',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNoteDisney' },
    chapters: { status: 'no' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'conditional', noteKey: 'rteNoteDisney' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteDisney' },
  }
} as const satisfies ProviderCapabilities;
