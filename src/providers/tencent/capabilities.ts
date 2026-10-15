import type { ProviderCapabilities } from '../capability-types';

export const tencentCapabilities = {
  id: 'tencent',
  name: 'Tencent Video / WeTV',
  // Reviewed 2026-10-15: https://designer.tencent.co.th/logo/wetv.html (brand page unavailable); supplied logo sampled directly; white play triangle.
  // Most frequent saturated opaque RGB samples in the supplied 142x106 logo: orange #EF8E34, green #78E445, blue #4396F7.
  brand: {
    primary: '#EF8E34',
    secondary: '#78E445',
    extra: ['#4396F7', '#FFFFFF'],
    // UI-only border tints: 55% mix reaches 3:1 on the dark surface, including interpolation.
    uiBorder: ['#F8CCA4', '#94EA6C', '#B8D7FC', '#FFFFFF'],
    uiAccent: '#EF8E34',
  },
  noteKey: 'rteNoteTencent',
  capabilities: {
    title: { status: 'yes' },
    subtitles: { status: 'conditional', noteKey: 'rteNoteTencent' },
    chapters: { status: 'no' },
    heatmap: { status: 'no' },
    thumbnails: { status: 'conditional', noteKey: 'rteNoteTencent' },
    quickActions: { status: 'conditional', noteKey: 'rteNoteTencent' },
  }
} as const satisfies ProviderCapabilities;
