import type { ProviderCapabilities } from '../capability-types';

export const crunchyrollCapabilities = {
  id: 'crunchyroll',
  name: 'Crunchyroll',
  // Reviewed 2026-10-15: https://www.crunchyroll.com/news/announcements/2024/7/18/crunchyroll-unveils-brand-evolution-ahead-of-san-diego-comic-con-debut ; https://cdn.jsdelivr.net/npm/simple-icons@latest/data/simple-icons.json (orange / black).
  brand: {
    primary: '#FF5E00',
    secondary: '#000000',
    // UI-only border tints: 55% mix reaches 3:1 on the dark surface, including interpolation.
    uiBorder: ['#FFB082', '#C2C2C2'],
    uiAccent: '#FF5E00',
  },
  noteKey: 'rteNoteCrunchyroll',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNoteCrunchyroll' },
    chapters: { status: 'conditional', noteKey: 'rteNoteCrunchyroll' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'conditional', noteKey: 'rteNoteCrunchyroll' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteCrunchyroll' },
  }
} as const satisfies ProviderCapabilities;
