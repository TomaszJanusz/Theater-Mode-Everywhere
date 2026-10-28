import type { Meta } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import { CAPTION_HUD, hudStory, type HudArgs } from '../../.storybook/hud-story';

import { LANGUAGE_MIN_VISIBLE_MS, LANGUAGE_LOAD_DELAY_MS } from './language-notice';
import { t } from './messages';
import { queryPlayerUi } from './root';

interface Args extends HudArgs {
  view: 'loading' | 'status' | 'loading-to-result';
  titleKey: 'subtitlesOnHud' | 'subtitlesOffHud' | 'noSubtitlesAvailable' | 'subtitlesLoadFailedHud';
  detail: string;
}
// View-API fixtures: result-to-view mapping in player-runtime is outside this component proof.
const meta: Meta<Args> = {
  title: 'Components/Caption notice', parameters: { timeline: 'caption' }, tags: ['frames'],
  args: { phase: 'steady', live: false, view: 'status', titleKey: 'subtitlesOnHud', detail: 'English (auto-generated)' },
  argTypes: {
    view: { control: 'select', options: ['loading', 'status', 'loading-to-result'] },
    titleKey: { control: 'select', options: ['subtitlesOnHud', 'subtitlesOffHud', 'noSubtitlesAvailable', 'subtitlesLoadFailedHud'] },
    detail: { control: 'text' },
    phase: { control: false }, live: { control: false }
  }
};
export default meta;

function caption(args: Partial<Args> = {}) {
  return hudStory<Args>((h, stage, values) => {
    if (values.view !== 'status') {
      h.triggerCaptionHud({ kind: 'loading', title: t('subtitlesLoadingHud') });
      stage.advance(LANGUAGE_LOAD_DELAY_MS);
    }
    if (values.view !== 'loading') h.triggerCaptionHud({ kind: 'status', title: t(values.titleKey), detail: values.detail });
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
  }, { leaveAfterMs: LANGUAGE_MIN_VISIBLE_MS });
}
export const Loading = caption({ view: 'loading' });
export const Status = caption();
export const LoadingToResult = caption({ view: 'loading-to-result', detail: 'Deutsch' });
