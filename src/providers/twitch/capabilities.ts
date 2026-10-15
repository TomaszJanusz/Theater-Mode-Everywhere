import type { ProviderCapabilities } from '../capability-types';

export const twitchCapabilities = {
  id: 'twitch',
  name: 'Twitch',
  // Reviewed 2026-10-15: https://brand.twitch.com/ ; https://cdn.jsdelivr.net/npm/simple-icons@latest/data/simple-icons.json (purple / white).
  brand: {
    primary: '#9146FF',
    secondary: '#FFFFFF',
    // UI-only border tints: 55% mix reaches 3:1 on the dark surface, including interpolation.
    uiBorder: ['#D8BEFF', '#FFFFFF'],
    // Lighten the primary only for UI track/focus contrast (at least 3:1).
    uiAccent: '#9A55FF',
  },
  noteKey: 'rteNoteTwitch',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNoteTwitch' },
    chapters: { status: 'conditional', noteKey: 'rteNoteTwitch' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'conditional', noteKey: 'rteNoteTwitch' },
    quickActions: { status: 'no' },
  }
} as const satisfies ProviderCapabilities;
