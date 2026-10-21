import type { Meta } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import { CAPTION_HUD, hudStory, type HudArgs } from '../../.storybook/hud-story';

import { CAPTION_LOADING_HUD_DELAY_MS } from './hud';
import { t } from './messages';
import { queryPlayerUi } from './root';

interface Args extends HudArgs {
  view: 'loading' | 'status' | 'loading-to-result';
  titleKey: 'subtitlesOnHud' | 'subtitlesOffHud' | 'noSubtitlesAvailable' | 'subtitlesLoadFailedHud';
  detail: string;
  duration: number;
}
// View-API fixtures: result-to-view mapping in player-runtime is outside this component proof.
const meta: Meta<Args> = {
  title: 'Components/Caption notice', parameters: { timeline: 'caption' }, tags: ['frames'],
  args: { phase: 'steady', live: false, view: 'status', titleKey: 'subtitlesOnHud', detail: 'English (auto-generated)', duration: 4000 },
  argTypes: {
    view: { control: 'select', options: ['loading', 'status', 'loading-to-result'] },
    titleKey: { control: 'select', options: ['subtitlesOnHud', 'subtitlesOffHud', 'noSubtitlesAvailable', 'subtitlesLoadFailedHud'] },
    detail: { control: 'text' }, duration: { control: { type: 'number', min: 100, max: 10000, step: 100 } },
    phase: { control: false }, live: { control: false }
  }
};
export default meta;

function caption(args: Partial<Args> = {}) {
  return hudStory<Args>((h, stage, values) => {
    if (values.view !== 'status') {
      h.triggerCaptionHud({ kind: 'loading', title: t('subtitlesLoadingHud') });
      stage.advance(CAPTION_LOADING_HUD_DELAY_MS);
    }
    if (values.view !== 'loading') h.triggerCaptionHud({ kind: 'status', title: t(values.titleKey), detail: values.detail, duration: values.duration });
  }, {
    args,
    play: async ({ args: values }) => {
      const node = queryPlayerUi<HTMLElement>(CAPTION_HUD);
      await expect(node?.querySelector('.volume-hud-text')?.textContent).toBe(t(values.view === 'loading' ? 'subtitlesLoadingHud' : values.titleKey));
      if (values.view === 'loading') {
        await expect(node?.classList.contains('loading')).toBe(true);
        await expect(node?.querySelector('.caption-hud-spinner')).not.toBeNull();
      } else await expect(node?.querySelector('.volume-hud-detail')?.textContent ?? '').toBe(values.detail);
      await expect(node?.getAttribute('dir')).toBe(t('@@bidi_dir'));
    }
  }, { leaveAfterMs: values => values.duration });
}
export const Loading = caption({ view: 'loading' });
export const Status = caption();
export const LoadingToResult = caption({ view: 'loading-to-result', detail: 'Deutsch' });
