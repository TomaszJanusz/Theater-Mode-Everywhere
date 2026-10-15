import type { ProviderCapabilities } from '../capability-types';

export const tencentCapabilities = {
  id: 'tencent',
  name: 'Tencent Video / WeTV',
  brandColors: ['#FF8800', '#0098FF', '#43E702', '#FFFFFF'],
  noteKey: 'rteNoteTencent',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNoteTencent' },
    chapters: { status: 'no' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'conditional', noteKey: 'rteNoteTencent' },
    playlists: { status: 'conditional', noteKey: 'rteNoteTencent' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteTencent' },
  }
} as const satisfies ProviderCapabilities;
