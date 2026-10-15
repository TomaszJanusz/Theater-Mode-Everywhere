import type { ProviderCapabilities } from '../capability-types';

export const twitchCapabilities = {
  id: 'twitch',
  name: 'Twitch',
  brandColors: ['#A441F7', '#000000', '#F7F7F7'],
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
