import type { ProviderCapabilities } from '../capability-types';

export const bilibiliCapabilities = {
  id: 'bilibili',
  name: 'Bilibili',
  // Reviewed 2026-10-15: https://cdn.jsdelivr.net/npm/simple-icons@latest/data/simple-icons.json ; https://colorarchive.org/brands/bilibili/ (blue, pink, white).
  brand: {
    primary: '#00A1D6',
    secondary: '#FB7299',
    extra: ['#FFFFFF'],
    // UI-only border tints: 55% mix reaches 3:1 on the dark surface, including interpolation.
    uiBorder: ['#8CD5ED', '#FDB7CB', '#FFFFFF'],
    uiAccent: '#00A1D6',
  },
  noteKey: 'rteNoteBilibili',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNoteBilibili' },
    chapters: { status: 'conditional', noteKey: 'rteNoteBilibili' },
    heatmap: { status: 'conditional', noteKey: 'rteNoteBilibili' },
    thumbnails: { status: 'conditional', noteKey: 'rteNoteBilibili' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteBilibili' },
  }
} as const satisfies ProviderCapabilities;
