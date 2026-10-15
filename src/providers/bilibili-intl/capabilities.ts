import type { ProviderCapabilities } from '../capability-types';

export const bilibiliIntlCapabilities = {
  id: 'bilibiliIntl',
  name: 'Bilibili.tv',
  // Reviewed 2026-10-15: https://p.bstarstatic.com/fe-lib/images/web/Brand%20Guidelines.pdf (white counterpart; PDF has older #4C93FF).
  // #06B6F2 is maintainer-supplied current cyan; not confirmed by the older official PDF.
  brand: {
    primary: '#06B6F2',
    secondary: '#FFFFFF',
    // UI-only border tints: 55% mix reaches 3:1 on the dark surface, including interpolation.
    uiBorder: ['#76D7F8', '#FFFFFF'],
    uiAccent: '#06B6F2',
  },
  noteKey: 'rteNoteBilibiliIntl',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNoteBilibiliIntl' },
    chapters: { status: 'conditional', noteKey: 'rteNoteBilibiliIntl' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'conditional', noteKey: 'rteNoteBilibiliIntl' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteBilibiliIntl' },
  }
} as const satisfies ProviderCapabilities;
