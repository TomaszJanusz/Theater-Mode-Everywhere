import { expect, test, vi } from 'vitest';

import { HUD_FADE_OUT_MS } from '../../src/ui/hud';
import type { CaptionHudView } from '../../src/ui/language-hud';
import {
  LANGUAGE_AFTER_UPDATE_MS, LANGUAGE_MIN_VISIBLE_MS, LANGUAGE_LOAD_DELAY_MS, type LanguageChanges, type LanguageSource
} from '../../src/ui/language-notice';
import { getPlayerUiRoot, queryPlayerUi } from '../../src/ui/root';
import { hudCase as hudStory, runHudCase, type HudCase } from '../fixture-test';
import { activeAnimationCount, uiNodeCount } from '../hud-stage';
import { CAPTION_HUD, hud, stage } from '../hud-story';

// Lifecycle of the merged language notice on a clock the case advances; the frames are in
// `Components/Language notice`.

const LOADING: CaptionHudView = { kind: 'loading', title: 'Subtitles', detail: 'Loading…' };
const ON: CaptionHudView = { kind: 'status', title: 'Subtitles', detail: 'English' };
const AUDIO: LanguageChanges = { audio: { kind: 'status', title: 'Audio', detail: 'Français' } };

const notice = () => queryPlayerUi<HTMLElement>(CAPTION_HUD);
const plates = () => getPlayerUiRoot().querySelectorAll(CAPTION_HUD).length;
const line = (source: LanguageSource) => notice()?.querySelector<HTMLElement>(`[data-language-line="${source}"]`) ?? null;
const lines = () => [...notice()?.querySelectorAll<HTMLElement>('[data-language-line]') ?? []]
  .map(node => [node.dataset.languageLine, node.textContent]);
/** Animations the language notice runs itself, not the spinner's endless CSS turn. */
const ownMotion = (node: Element) => node.getAnimations({ subtree: true }).filter(animation => !(animation instanceof CSSAnimation));
/** The plate's morph: the size ease, the slides and the rows fading out, which hold their last frame until they finish. */
const morph = (plate: Element) => ownMotion(plate).filter(animation => animation.effect?.getTiming().fill === 'forwards');
const heightFrames = (plate: Element) => morph(plate).filter(animation => animation.effect === null ? false : animation.effect instanceof KeyframeEffect
  && animation.effect.target === plate).flatMap(animation => (animation.effect as KeyframeEffect).getKeyframes().map(frame => frame.height));
const plateHeight = () => notice()!.getBoundingClientRect().height;
/** Lets the morph run to its end, as real time would. */
async function finishMorph(plate: Element): Promise<void> {
  for (const animation of morph(plate)) animation.finish();
  await vi.waitFor(() => expect(morph(plate)).toEqual([]));
}
/** Cells of rows that left, still fading in place. */
const leaving = () => notice()?.querySelectorAll(':scope > .language-hud-label, :scope > .language-hud-value').length ?? 0;

test('Audio joins a turning spinner, which keeps turning and then resolves with the audio line intact', () => runHudCase(hudStory(h => h.triggerCaptionHud(LOADING), {
  play: async () => {
    stage().advance(LANGUAGE_LOAD_DELAY_MS);
    const plate = notice()!;
    const spinner = plate.querySelector<HTMLElement>('[data-language-line="subtitles"] .language-hud-value .language-hud-spinner')!;
    await finishMorph(plate);
    const loadingHeight = plateHeight();
    const turn = spinner.getAnimations()[0];
    await expect(turn).toBeInstanceOf(CSSAnimation);

    hud().updateLanguageHud(AUDIO);
    await expect(notice()).toBe(plate);
    await expect(plates()).toBe(1);
    await expect(plate.querySelector('.language-hud-spinner')).toBe(spinner);
    await expect(spinner.getAnimations()).toEqual([turn]);
    await expect(lines()).toEqual([['subtitles', 'SubtitlesLoading…'], ['audio', 'AudioFrançais']]);
    await expect(ownMotion(line('audio')!).length).toBeGreaterThan(0);
    const audioLine = line('audio')!;

    stage().advance(10_000);
    await expect(notice()?.classList.contains('fade-out')).toBe(false);
    hud().triggerCaptionHud(ON);
    await expect(notice()).toBe(plate);
    await expect(line('audio')).toBe(audioLine);
    await expect(spinner.isConnected).toBe(true);
    const exit = ownMotion(spinner);
    await expect(exit.length).toBe(1);
    // An audio answer during the exit repaints only its own line: the zoom-out is not restarted or cut.
    hud().updateLanguageHud({ audio: { kind: 'status', title: 'Audio', detail: 'Deutsch' } });
    await expect(ownMotion(spinner)).toEqual(exit);
    await expect(exit[0].playState).not.toBe('idle');
    exit[0].finish();
    await vi.waitFor(() => expect(spinner.isConnected).toBe(false));
    await finishMorph(plate);
    await expect(lines()).toEqual([['subtitles', 'SubtitlesEnglish'], ['audio', 'AudioDeutsch']]);
    await expect(line('audio')).toBe(audioLine);
    // Back to one row: the value took the spinner's place without changing the row's height.
    hud().updateLanguageHud({ audio: null });
    await finishMorph(plate);
    await expect(plateHeight()).toBe(loadingHeight);
  }
})));

test('Subtitles then audio, and audio then subtitles, share one plate in a fixed order', () => runHudCase(hudStory(h => h.triggerCaptionHud(ON), {
  play: async () => {
    const plate = notice()!;
    stage().advance(1000);
    hud().updateLanguageHud(AUDIO);
    await expect(notice()).toBe(plate);
    await expect(lines()).toEqual([['subtitles', 'SubtitlesEnglish'], ['audio', 'AudioFrançais']]);
    hud().removeCaptionHud();

    hud().updateLanguageHud(AUDIO);
    const audioFirst = notice()!;
    hud().triggerCaptionHud({ kind: 'status', title: 'Subtitles', detail: 'English (United Kingdom), auto-generated' });
    await expect(notice()).toBe(audioFirst);
    // While the plate eases from the audio row's width, the wider subtitles value is cut, not rewrapped.
    const title = line('subtitles')!.querySelector('.language-hud-value')!;
    const easing = title.getBoundingClientRect().height;
    for (const animation of audioFirst.getAnimations({ subtree: true })) animation.cancel();
    await expect(easing).toBe(title.getBoundingClientRect().height);
    hud().triggerCaptionHud(ON);
    await expect(plates()).toBe(1);
    await expect(lines()).toEqual([['subtitles', 'SubtitlesEnglish'], ['audio', 'AudioFrançais']]);
    hud().triggerCaptionHud({ kind: 'dismiss' });
    await expect(lines()).toEqual([['audio', 'AudioFrançais']]);
  }
})));

/** The edge of a cell on the plate's inline end (the corner side): right in LTR, left in RTL. */
const endEdge = (cell: Element) => {
  const rect = cell.getBoundingClientRect();
  return getComputedStyle(cell).direction === 'rtl' ? rect.left : rect.right;
};

// The plate is anchored to its corner and grows away from it, so labels on the end edge never move.
for (const [name, locale] of [['LTR', 'en'], ['RTL', 'ar']] as const) {
  test(`${name}: the labels keep their edge while the values change width, value before label`, () => runHudCase({
    ...hudStory(h => { h.triggerCaptionHud(ON); h.updateLanguageHud(AUDIO); }, {
      play: async () => {
        const plate = notice()!;
        const label = (source: LanguageSource) => line(source)!.querySelector('.language-hud-label')!;
        const value = (source: LanguageSource) => line(source)!.querySelector('.language-hud-value')!;
        const edges = () => ({ subtitles: endEdge(label('subtitles')), audio: endEdge(label('audio')) });
        await finishMorph(plate);
        const placed = edges();
        // The value sits on the start side of its label, beside it.
        for (const source of ['subtitles', 'audio'] as const) {
          const [v, l] = [value(source).getBoundingClientRect(), label(source).getBoundingClientRect()];
          await expect(locale === 'ar' ? v.left >= l.right : v.right <= l.left).toBe(true);
        }
        for (const detail of ['Off', 'Français (France), audio description', 'Off']) {
          hud().triggerCaptionHud({ kind: 'status', title: 'Subtitles', detail });
          hud().updateLanguageHud({ audio: { kind: 'status', title: 'Audio', detail: detail === 'Off' ? 'English' : detail } });
          await expect(edges()).toEqual(placed);
          await finishMorph(plate);
          await expect(edges()).toEqual(placed);
        }
      }
    }),
    globals: { locale }
  }));
}

test('An update at 1 s keeps the 4 s minimum; at 3.5 s it holds 2 s more', () => runHudCase(hudStory(() => {}, {
  play: async () => {
    for (const [at, hideAt] of [[1000, LANGUAGE_MIN_VISIBLE_MS], [3500, 3500 + LANGUAGE_AFTER_UPDATE_MS]]) {
      hud().triggerCaptionHud(ON);
      const plate = notice()!;
      stage().advance(at);
      hud().updateLanguageHud(AUDIO);
      stage().advance(hideAt - at - 1);
      await expect(plate.classList.contains('fade-out')).toBe(false);
      stage().advance(1);
      await expect(plate.classList.contains('fade-out')).toBe(true);
      stage().advance(HUD_FADE_OUT_MS);
      await expect(plate.isConnected).toBe(false);
      await expect(stage().clock.pending).toBe(0);
    }
  }
})));

test('An update at 4.1 s, while the plate fades, shows as a fresh notice', () => runHudCase(hudStory(h => h.triggerCaptionHud(ON), {
  play: async () => {
    const fading = notice()!;
    stage().advance(4100);
    await expect(fading.classList.contains('fade-out')).toBe(true);
    hud().updateLanguageHud(AUDIO);
    await expect(fading.isConnected).toBe(false);
    await expect(plates()).toBe(1);
    await expect(lines()).toEqual([['audio', 'AudioFrançais']]);
    stage().advance(LANGUAGE_MIN_VISIBLE_MS - 1);
    await expect(notice()?.classList.contains('fade-out')).toBe(false);
    stage().advance(1);
    await expect(notice()?.classList.contains('fade-out')).toBe(true);
  }
})));

test('A refused pick is its own line and the merged text is read once', () => runHudCase(hudStory(h => h.triggerCaptionHud(ON), {
  play: async () => {
    hud().updateLanguageHud({ ...AUDIO, audioRefused: { kind: 'status', title: 'Audio', detail: "Couldn't switch to Deutsch" } });
    await expect(lines()).toEqual([['subtitles', 'SubtitlesEnglish'], ['audio', 'AudioFrançais'], ['audioRefused', "AudioCouldn't switch to Deutsch"]]);
    const region = getPlayerUiRoot().getElementById('theater-announcements')!;
    await vi.waitFor(() => expect(region.textContent).toBe("Subtitles: English. Audio: Français. Audio: Couldn't switch to Deutsch"));
  }
})));

test('Reduce motion: rows join, resolve and leave at once, without a morph', () => runHudCase({
  ...hudStory(h => h.triggerCaptionHud(LOADING), {
    play: async () => {
      stage().advance(LANGUAGE_LOAD_DELAY_MS);
      const oneRow = plateHeight();
      hud().updateLanguageHud(AUDIO);
      await expect(ownMotion(notice()!)).toEqual([]);
      await expect(plateHeight()).toBeGreaterThan(oneRow);
      hud().triggerCaptionHud(ON);
      await expect(notice()?.querySelector('.language-hud-spinner, .language-hud-loading')).toBeNull();
      await expect(ownMotion(notice()!)).toEqual([]);
      await expect(lines()).toEqual([['subtitles', 'SubtitlesEnglish'], ['audio', 'AudioFrançais']]);
      hud().updateLanguageHud({ audio: null });
      await expect(leaving()).toBe(0);
      await expect(ownMotion(notice()!)).toEqual([]);
      await expect(plateHeight()).toBe(oneRow);
    }
  }),
  globals: { reduceMotion: 'on' }
}));

test('A row that joins grows the plate from its old height and fades in; one that leaves fades while the plate closes', () => runHudCase(hudStory(h => h.triggerCaptionHud(ON), {
  play: async () => {
    const plate = notice()!;
    const oneRow = plateHeight();
    // A long value widens the columns: the subtitles row must not jump sideways when it joins or leaves.
    const kept = () => { const { x, y } = line('subtitles')!.firstElementChild!.getBoundingClientRect(); return { x, y }; };
    const keptBefore = kept();
    hud().updateLanguageHud({ audio: { kind: 'status', title: 'Audio', detail: 'Português (Brasil), dublado' } });
    await expect(kept()).toEqual(keptBefore);
    const [from, to] = heightFrames(plate);
    await expect(Number.parseFloat(String(from))).toBeCloseTo(oneRow, 1);
    await expect(plateHeight()).toBeCloseTo(oneRow, 1);
    await expect(ownMotion(line('audio')!.firstElementChild!).length).toBeGreaterThan(0);
    await finishMorph(plate);
    const twoRows = plateHeight();
    await expect(twoRows).toBeCloseTo(Number.parseFloat(String(to)), 1);

    const rects = (cells: Element[]) => cells.map(cell => { const { x, y, width } = cell.getBoundingClientRect(); return { x, y, width }; });
    const placed = rects([...line('audio')!.children]);
    const keptWide = kept();
    hud().updateLanguageHud({ audio: null });
    await expect(kept()).toEqual(keptWide);
    await expect(lines()).toEqual([['subtitles', 'SubtitlesEnglish']]);
    await expect(leaving()).toBe(2);
    await expect(rects([...plate.querySelectorAll(':scope > .language-hud-label, :scope > .language-hud-value')])).toEqual(placed);
    await expect(plateHeight()).toBeCloseTo(twoRows, 1);
    await finishMorph(plate);
    await expect(leaving()).toBe(0);
    await expect(plateHeight()).toBeCloseTo(oneRow, 1);
  }
})));

test('Cleanup in the middle of a morph leaves no node, animation or timer', () => runHudCase(hudStory(h => { h.triggerCaptionHud(ON); h.updateLanguageHud(AUDIO); }, {
  play: async () => {
    await finishMorph(notice()!);
    hud().updateLanguageHud({ audio: null, audioRefused: { kind: 'status', title: 'Audio', detail: "Couldn't switch to Deutsch" } });
    await expect(leaving()).toBe(2);
    await expect(morph(notice()!).length).toBeGreaterThan(0);
    hud().removeCaptionHud();
    hud().removeCaptionHud();
    await expect(uiNodeCount()).toBe(0);
    await expect(activeAnimationCount()).toBe(0);
    await expect(stage().clock.pending).toBe(0);
  }
})));

test('Exit leaves no node, timer or animation, and repeats safely', () => runHudCase(hudStory(h => h.triggerCaptionHud(LOADING), {
  play: async () => {
    stage().advance(LANGUAGE_LOAD_DELAY_MS);
    hud().updateLanguageHud(AUDIO);
    hud().triggerCaptionHud(ON);
    hud().triggerCaptionHud(LOADING);
    hud().removeCaptionHud();
    hud().removeCaptionHud();
    await expect(uiNodeCount()).toBe(0);
    await expect(stage().clock.pending).toBe(0);
    await expect(activeAnimationCount()).toBe(0);
    stage().advance(LANGUAGE_LOAD_DELAY_MS);
    await expect(notice()).toBeNull();
  }
})));

test('A stale session shows nothing of the old lines', () => runHudCase(hudStory(h => { h.triggerCaptionHud(ON); h.updateLanguageHud(AUDIO); }, {
  play: async () => {
    stage().session.currentEpoch += 1;
    hud().updateLanguageHud({ audio: { kind: 'status', title: 'Audio', detail: 'Deutsch' } });
    await expect(plates()).toBe(1);
    await expect(lines()).toEqual([['audio', 'AudioDeutsch']]);
  }
}) as HudCase));
