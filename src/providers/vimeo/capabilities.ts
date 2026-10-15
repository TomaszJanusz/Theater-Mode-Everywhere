import type { ProviderCapabilities } from '../capability-types';

export const vimeoCapabilities = {
  id: 'vimeo',
  name: 'Vimeo',
  brandColors: ['#15D5FF', '#141A20'],
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
