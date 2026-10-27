import type { ProviderCapabilities } from '../capability-types';

export const crunchyrollCapabilities = {
  id: 'crunchyroll',
  name: 'Crunchyroll',
  brandColors: ['#FF640C', '#272727'],
  noteKey: 'rteNoteCrunchyroll',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNoteCrunchyroll' },
    audio: { status: 'no' },
    chapters: { status: 'conditional', noteKey: 'rteNoteCrunchyroll' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'conditional', noteKey: 'rteNoteCrunchyroll' },
    playlists: { status: 'no' },
    launcher: { status: 'no' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteCrunchyroll' },
    autoTheater: { status: 'no' }
  }
} as const satisfies ProviderCapabilities;
