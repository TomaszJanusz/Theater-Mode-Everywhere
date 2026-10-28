import type { Meta } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import type { HudStage } from '../../.storybook/hud-stage';
import { CAPTION_HUD, hudStory, type HudArgs } from '../../.storybook/hud-story';

import type { LanguageChanges } from './language-notice';
import { LANGUAGE_MIN_VISIBLE_MS, LANGUAGE_LOAD_DELAY_MS } from './language-notice';
import { t } from './messages';
import { getPlayerUiRoot, queryPlayerUi } from './root';

// The lines the runtime sets (`showCaptionHud` and `showAudioTrackHud` in player-runtime.ts), built when
// the story renders, after the locale global has loaded its catalog. Track names are fixture data.
const subtitlesOn = (): LanguageChanges => ({ subtitles: { kind: 'status', title: t('subtitlesOnHud'), detail: 'English' } });
const subtitlesLoading = (): LanguageChanges => ({ subtitles: { kind: 'loading', title: t('subtitlesLoadingHud') } });
const audio = (detail = 'Français'): LanguageChanges => ({ audio: { kind: 'status', title: t('audioTrackLabel'), detail } });
const refused = (): LanguageChanges => ({ audioRefused: { kind: 'status', title: t('audioTrackFailedHud'), detail: 'Deutsch' } });
/** Where a later line joins: a second into the notice, well inside its minimum time. */
const JOIN_AFTER_MS = 1000;

const meta: Meta<HudArgs> = {
  title: 'Components/Language notice', parameters: { timeline: 'caption' }, tags: ['frames'],
  args: { phase: 'steady', live: false },
  argTypes: { phase: { control: false }, live: { control: false } }
};
export default meta;

/** Source, title and detail of every line, top to bottom. */
const lines = () => [...queryPlayerUi<HTMLElement>(CAPTION_HUD)?.querySelectorAll<HTMLElement>('[data-language-line]') ?? []]
  .map(node => [node.dataset.languageLine, node.querySelector('.volume-hud-text')?.textContent, node.querySelector('.volume-hud-detail')?.textContent ?? null]);
const plates = () => getPlayerUiRoot().querySelectorAll(CAPTION_HUD).length;

/**
 * Time passing between steps lets the motion of earlier steps end, as it would on screen; a held
 * frame then shows only the motion of the last step. The spinner's endless turn is left alone.
 */
function endEarlierMotion(): void {
  for (const animation of getPlayerUiRoot().getAnimations()) {
    if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.cancel();
  }
}

function language(steps: (stage: HudStage) => Array<LanguageChanges | number>, expected: () => unknown[], leaveAfterMs?: number) {
  return hudStory((h, stage) => {
    for (const step of steps(stage)) {
      if (typeof step === 'number') {
        stage.advance(step);
        endEarlierMotion();
      } else h.updateLanguageHud(step);
    }
  }, {
    play: async () => {
      await expect(plates()).toBe(1);
      await expect(lines()).toEqual(expected());
    }
  }, { leaveAfterMs });
}

/** The track a pick or the saved language switched to, or that was already playing. */
export const AudioOnly = language(() => [audio()], () => [['audio', t('audioTrackLabel'), 'Français']], LANGUAGE_MIN_VISIBLE_MS);

/** Default keeps the track playing and says so. */
export const AudioDefault = language(() => [audio(t('audioTrackDefaultHud', 'English'))],
  () => [['audio', t('audioTrackLabel'), t('audioTrackDefaultHud', 'English')]], LANGUAGE_MIN_VISIBLE_MS);

/** The audio line joins the subtitles notice: one plate grows to two lines and the subtitles stay. */
export const Merged = language(() => [subtitlesOn(), JOIN_AFTER_MS, audio()],
  () => [['subtitles', t('subtitlesOnHud'), 'English'], ['audio', t('audioTrackLabel'), 'Français']],
  LANGUAGE_MIN_VISIBLE_MS - JOIN_AFTER_MS);

/** Subtitles that arrive second take their place above the audio line. */
export const AudioThenSubtitles = language(() => [audio(), JOIN_AFTER_MS, subtitlesOn()],
  () => [['subtitles', t('subtitlesOnHud'), 'English'], ['audio', t('audioTrackLabel'), 'Français']],
  LANGUAGE_MIN_VISIBLE_MS - JOIN_AFTER_MS);

/** While subtitles load, the audio line joins the plate with the spinner and the spinner keeps turning. */
export const SpinnerWithAudio = {
  ...language(() => [subtitlesLoading(), LANGUAGE_LOAD_DELAY_MS, audio()],
    () => [['subtitles', t('subtitlesLoadingHud'), null], ['audio', t('audioTrackLabel'), 'Français']]),
  parameters: { timeline: undefined }
};

/** Then the subtitles resolve: the spinner zooms out into the language and the audio line stays as it was. */
export const SpinnerResolvesWithAudio = language(
  () => [subtitlesLoading(), LANGUAGE_LOAD_DELAY_MS, audio(), JOIN_AFTER_MS, subtitlesOn()],
  () => [['subtitles', t('subtitlesOnHud'), 'English'], ['audio', t('audioTrackLabel'), 'Français']],
  LANGUAGE_MIN_VISIBLE_MS);

/** A refused pick is its own line, under the track that still plays. */
export const Refused = language(() => [{ ...audio('English'), ...refused() }],
  () => [['audio', t('audioTrackLabel'), 'English'], ['audioRefused', t('audioTrackFailedHud'), 'Deutsch']],
  LANGUAGE_MIN_VISIBLE_MS);
