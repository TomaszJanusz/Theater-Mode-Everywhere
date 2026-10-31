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
const subtitlesOn = (): LanguageChanges => ({ subtitles: { kind: 'status', title: t('subtitlesMenuTitle'), detail: 'English' } });
const subtitlesLoading = (): LanguageChanges => ({ subtitles: { kind: 'loading', title: t('subtitlesMenuTitle'), detail: t('loadingLabel') } });
/** A load whose language is known: the name beside the spinner, as `showCaptionHud` sets it. */
const loadingNamed = (detail: string): LanguageChanges => ({
  subtitles: { kind: 'loading', title: t('subtitlesMenuTitle'), detail, announce: t('subtitlesLoadingNamedHud', detail) }
});
const audio = (detail = 'Français'): LanguageChanges => ({ audio: { kind: 'status', title: t('audioHudLabel'), detail }, audioRefused: null });
const refused = (): LanguageChanges => ({ audioRefused: { kind: 'status', title: t('audioHudLabel'), detail: t('audioTrackRefusedHud', 'Deutsch') } });
const SUBTITLES_ON = () => ['subtitles', t('subtitlesMenuTitle'), 'English'];
const AUDIO_ROW = (detail = 'Français') => ['audio', t('audioHudLabel'), detail];
/** Where a later row joins: a second into the notice, well inside its minimum time. */
const JOIN_AFTER_MS = 1000;

const meta: Meta<HudArgs> = {
  title: 'Components/Language notice', parameters: { timeline: 'caption' }, tags: ['frames'],
  args: { phase: 'steady', live: false },
  argTypes: { phase: { control: false }, live: { control: false } }
};
export default meta;

/** Source, label and value of every row, top to bottom; a held frame may still show a spinner on its way out. */
const lines = () => [...queryPlayerUi<HTMLElement>(CAPTION_HUD)?.querySelectorAll<HTMLElement>('[data-language-line]') ?? []]
  .map(node => [node.dataset.languageLine, node.querySelector('.language-hud-label')?.textContent,
    (node.querySelector('.language-hud-text') ?? node.querySelector('.language-hud-loading-text'))?.textContent]);
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

/** A spinner's zoom-out runs to its end, as it would after its half second: the plate then eases to the new width. */
function finishSpinnerExit(): void {
  for (const animation of getPlayerUiRoot().getAnimations()) {
    const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
    // Its end is reported now, not on the next frame, so the plate's ease exists when the stage holds it.
    if (target?.classList.contains('language-hud-spinner') && Number.isFinite(animation.effect?.getComputedTiming().endTime)) {
      (animation.onfinish as ((event: Event) => void) | null)?.call(animation, new Event('finish'));
    }
  }
}

function language(steps: (stage: HudStage) => Array<LanguageChanges | number | 'resolve'>, expected: () => unknown[], leaveAfterMs?: number) {
  return hudStory((h, stage) => {
    for (const step of steps(stage)) {
      if (typeof step === 'number') {
        stage.advance(step);
        endEarlierMotion();
      } else if (step === 'resolve') finishSpinnerExit();
      else h.updateLanguageHud(step);
    }
  }, {
    play: async () => {
      await expect(plates()).toBe(1);
      await expect(lines()).toEqual(expected());
    }
  }, { leaveAfterMs });
}

const subtitles = (detail: string): LanguageChanges => ({ subtitles: { kind: 'status', title: t('subtitlesMenuTitle'), detail } });

/** Values of different widths: the labels sit on the plate's end edge and the values end beside them. */
export const ShortValues = language(() => [subtitles('Off'), audio('English')],
  () => [['subtitles', t('subtitlesMenuTitle'), 'Off'], AUDIO_ROW('English')], LANGUAGE_MIN_VISIBLE_MS);
export const LongValues = language(() => [subtitles('Português (Brasil), automatic'), audio('Français (France), audio description')],
  () => [['subtitles', t('subtitlesMenuTitle'), 'Português (Brasil), automatic'], AUDIO_ROW('Français (France), audio description')],
  LANGUAGE_MIN_VISIBLE_MS);

/** Track names long enough to wrap at the value's width limit; fixture data, as on a YouTube watch page. */
const LONG_TRACK = 'Português (Brasil), automatic captions generated from the original English audio track';
const LONG_AUDIO = 'Français (France), audio description with commentary by the director and the cast';

const NAMED_ROW = (detail: string) => ['subtitles', t('subtitlesMenuTitle'), detail];
/** The load named the language: the spinner zooms out, the name stays where it is, and the plate eases to the narrower row. */
export const NamedSpinnerResolves = language(() => [loadingNamed('Polski'), LANGUAGE_LOAD_DELAY_MS, subtitles('Polski'), 'resolve'],
  () => [NAMED_ROW('Polski')], LANGUAGE_MIN_VISIBLE_MS);
/** The same with a name that wraps onto two lines: the label stays on the row's middle and nothing rewraps. */
export const NamedSpinnerResolvesLong = language(() => [loadingNamed(LONG_TRACK), LANGUAGE_LOAD_DELAY_MS, subtitles(LONG_TRACK), 'resolve'],
  () => [NAMED_ROW(LONG_TRACK)], LANGUAGE_MIN_VISIBLE_MS);
/** A new pick while the spinner turns: it keeps turning, the name changes and the plate eases to the new width. */
export const NamedSpinnerSuperseded = language(() => [loadingNamed('Polski'), LANGUAGE_LOAD_DELAY_MS, loadingNamed(LONG_TRACK)],
  () => [NAMED_ROW(LONG_TRACK)]);

/** A value that wraps to two lines: its row grows and the label sits on the middle of that row, beside a one-line row. */
export const WrappedValue = language(() => [subtitles(LONG_TRACK), audio('English')],
  () => [['subtitles', t('subtitlesMenuTitle'), LONG_TRACK], AUDIO_ROW('English')], LANGUAGE_MIN_VISIBLE_MS);

/** A label wider than the shipped ones widens the column and stays on one line, centred on a wrapped row. */
export const LongLabel = language(() => [{ audio: { kind: 'status', title: 'Audio description', detail: LONG_AUDIO } }],
  () => [['audio', 'Audio description', LONG_AUDIO]], LANGUAGE_MIN_VISIBLE_MS);

/** The track a pick or the saved language switched to, or that was already playing. */
export const AudioOnly = language(() => [audio()], () => [AUDIO_ROW()], LANGUAGE_MIN_VISIBLE_MS);

/** Default keeps the track playing and says so, in the value. */
export const AudioDefault = language(() => [audio(t('audioTrackDefaultHud', 'English'))],
  () => [AUDIO_ROW(t('audioTrackDefaultHud', 'English'))], LANGUAGE_MIN_VISIBLE_MS);

/** The audio row joins the subtitles notice: the plate grows to two rows and the new row fades in. */
export const Merged = language(() => [subtitlesOn(), JOIN_AFTER_MS, audio()], () => [SUBTITLES_ON(), AUDIO_ROW()],
  LANGUAGE_MIN_VISIBLE_MS - JOIN_AFTER_MS);

/** Subtitles that arrive second take their place above the audio row, which slides down. */
export const AudioThenSubtitles = language(() => [audio(), JOIN_AFTER_MS, subtitlesOn()], () => [SUBTITLES_ON(), AUDIO_ROW()],
  LANGUAGE_MIN_VISIBLE_MS - JOIN_AFTER_MS);

/** While subtitles load, the audio row joins the plate and the spinner in the subtitles row keeps turning. */
export const SpinnerWithAudio = {
  ...language(() => [subtitlesLoading(), LANGUAGE_LOAD_DELAY_MS, audio()],
    () => [['subtitles', t('subtitlesMenuTitle'), t('loadingLabel')], AUDIO_ROW()]),
  parameters: { timeline: undefined }
};

/** Then the subtitles resolve: the spinner zooms out into the language, in the same row, and the audio row stays. */
export const SpinnerResolvesWithAudio = language(
  () => [subtitlesLoading(), LANGUAGE_LOAD_DELAY_MS, audio(), JOIN_AFTER_MS, subtitlesOn()],
  () => [SUBTITLES_ON(), AUDIO_ROW()], LANGUAGE_MIN_VISIBLE_MS);

/** A refused pick is its own row, under the track that still plays. */
export const Refused = language(() => [{ ...audio('English'), ...refused() }],
  () => [AUDIO_ROW('English'), ['audioRefused', t('audioHudLabel'), t('audioTrackRefusedHud', 'Deutsch')]],
  LANGUAGE_MIN_VISIBLE_MS);

/** A successful pick after a refusal: the refusal row fades out in place while the plate closes over it. */
export const RowLeaves = language(() => [{ ...audio('English'), ...refused() }, JOIN_AFTER_MS, audio('Deutsch')],
  () => [AUDIO_ROW('Deutsch')], LANGUAGE_MIN_VISIBLE_MS - JOIN_AFTER_MS);
