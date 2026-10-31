import type { Meta } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import { CAPTION_HUD, hudStory, type HudArgs } from '../../.storybook/hud-story';

import { LANGUAGE_MIN_VISIBLE_MS, LANGUAGE_LOAD_DELAY_MS } from './language-notice';
import { t } from './messages';
import { queryPlayerUi } from './root';

interface Args extends HudArgs {
  view: 'loading' | 'status' | 'loading-to-result';
  /** The subtitles state; `on` shows `detail`, the track name. */
  state: 'on' | 'off' | 'none' | 'failed';
  detail: string;
  /** The loading state names `detail`, as when the track is known at the start of the load. */
  named: boolean;
}
// The row's value for each state, as `showCaptionHud` in player-runtime.ts maps them.
const STATE_KEYS = { off: 'subtitlesOff', none: 'subtitlesHudNone', failed: 'subtitlesHudFailed' } as const;
const value = (values: Args) => values.state === 'on' ? values.detail : t(STATE_KEYS[values.state]);
/** The loading value: the track being loaded when known, else the generic text (`showCaptionHud` in player-runtime.ts). */
const loadingText = (values: Args) => values.named ? values.detail : t('loadingLabel');
// View-API fixtures: result-to-view mapping in player-runtime is outside this component proof.
const meta: Meta<Args> = {
  title: 'Components/Caption notice', parameters: { timeline: 'caption' }, tags: ['frames'],
  args: { phase: 'steady', live: false, view: 'status', state: 'on', detail: 'English (auto-generated)', named: false },
  argTypes: {
    view: { control: 'select', options: ['loading', 'status', 'loading-to-result'] },
    state: { control: 'select', options: ['on', 'off', 'none', 'failed'] },
    detail: { control: 'text' },
    named: { control: 'boolean' },
    phase: { control: false }, live: { control: false }
  }
};
export default meta;

function caption(args: Partial<Args> = {}) {
  return hudStory<Args>((h, stage, values) => {
    const title = t('subtitlesMenuTitle');
    if (values.view !== 'status') {
      h.triggerCaptionHud({ kind: 'loading', title, detail: loadingText(values) });
      stage.advance(LANGUAGE_LOAD_DELAY_MS);
    }
    if (values.view !== 'loading') h.triggerCaptionHud({ kind: 'status', title, detail: value(values) });
  }, {
    args,
    play: async ({ args: values }) => {
      const node = queryPlayerUi<HTMLElement>(CAPTION_HUD);
      await expect(node?.querySelector('.language-hud-label')?.textContent).toBe(t('subtitlesMenuTitle'));
      if (values.view === 'loading') {
        await expect(node?.querySelector('.language-hud-value .language-hud-spinner')).not.toBeNull();
        await expect(node?.querySelector('.language-hud-loading-text')?.textContent).toBe(loadingText(values));
      } else await expect(node?.querySelector('.language-hud-text')?.textContent).toBe(value(values));
      await expect(node?.getAttribute('dir')).toBe(t('@@bidi_dir'));
    }
  }, { leaveAfterMs: LANGUAGE_MIN_VISIBLE_MS });
}
export const Loading = caption({ view: 'loading' });
export const Status = caption();
export const LoadingToResult = caption({ view: 'loading-to-result', detail: 'Deutsch' });

/** The language is known when the load starts: the spinner turns beside its name. */
export const LoadingNamed = caption({ view: 'loading', detail: 'Polski', named: true });
const LONG_NAME = 'Português (Brasil), automatic captions generated from the original English audio track';
/** A long name wraps onto a second line beside the spinner, and the label stays on the row's middle. */
export const LoadingNamedLong = caption({ view: 'loading', detail: LONG_NAME, named: true });
