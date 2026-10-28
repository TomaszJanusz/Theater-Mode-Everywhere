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

const LOADING: CaptionHudView = { kind: 'loading', title: 'Loading subtitles…' };
const ON: CaptionHudView = { kind: 'status', title: 'Subtitles on', detail: 'English' };
const AUDIO: LanguageChanges = { audio: { kind: 'status', title: 'Audio track', detail: 'Français' } };

const notice = () => queryPlayerUi<HTMLElement>(CAPTION_HUD);
const plates = () => getPlayerUiRoot().querySelectorAll(CAPTION_HUD).length;
const line = (source: LanguageSource) => notice()?.querySelector<HTMLElement>(`[data-language-line="${source}"]`) ?? null;
const lines = () => [...notice()?.querySelectorAll<HTMLElement>('[data-language-line]') ?? []]
  .map(node => [node.dataset.languageLine, node.textContent]);
/** Animations the language notice runs itself, not the spinner's endless CSS turn. */
const ownMotion = (node: Element) => node.getAnimations({ subtree: true }).filter(animation => !(animation instanceof CSSAnimation));

test('Audio joins a turning spinner, which keeps turning and then resolves with the audio line intact', () => runHudCase(hudStory(h => h.triggerCaptionHud(LOADING), {
  play: async () => {
    stage().advance(LANGUAGE_LOAD_DELAY_MS);
    const plate = notice()!;
    const spinner = plate.querySelector<HTMLElement>('.caption-hud-spinner')!;
    const turn = spinner.getAnimations()[0];
    await expect(turn).toBeInstanceOf(CSSAnimation);

    hud().updateLanguageHud(AUDIO);
    await expect(notice()).toBe(plate);
    await expect(plates()).toBe(1);
    await expect(plate.querySelector('.caption-hud-spinner')).toBe(spinner);
    await expect(spinner.getAnimations()).toEqual([turn]);
    await expect(lines()).toEqual([['subtitles', 'Loading subtitles…'], ['audio', 'Audio trackFrançais']]);
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
    hud().updateLanguageHud({ audio: { kind: 'status', title: 'Audio track', detail: 'Deutsch' } });
    await expect(ownMotion(spinner)).toEqual(exit);
    await expect(exit[0].playState).not.toBe('idle');
    exit[0].finish();
    await vi.waitFor(() => expect(spinner.isConnected).toBe(false));
    await expect(plate.querySelector('.caption-hud-spinner-slot')).not.toBeNull();
    await expect(lines()).toEqual([['subtitles', 'Subtitles onEnglish'], ['audio', 'Audio trackDeutsch']]);
    await expect(line('audio')).toBe(audioLine);
  }
})));

test('Subtitles then audio, and audio then subtitles, share one plate in a fixed order', () => runHudCase(hudStory(h => h.triggerCaptionHud(ON), {
  play: async () => {
    const plate = notice()!;
    stage().advance(1000);
    hud().updateLanguageHud(AUDIO);
    await expect(notice()).toBe(plate);
    await expect(lines()).toEqual([['subtitles', 'Subtitles onEnglish'], ['audio', 'Audio trackFrançais']]);
    hud().removeCaptionHud();

    hud().updateLanguageHud(AUDIO);
    const audioFirst = notice()!;
    hud().triggerCaptionHud({ kind: 'status', title: 'Subtitles on', detail: 'English (United Kingdom)' });
    await expect(notice()).toBe(audioFirst);
    // While the plate eases from the audio line's width, the wider subtitles line is cut, not rewrapped.
    const title = line('subtitles')!.querySelector('.volume-hud-text')!;
    const easing = title.getBoundingClientRect().height;
    for (const animation of audioFirst.getAnimations({ subtree: true })) animation.cancel();
    await expect(easing).toBe(title.getBoundingClientRect().height);
    hud().triggerCaptionHud(ON);
    await expect(plates()).toBe(1);
    await expect(lines()).toEqual([['subtitles', 'Subtitles onEnglish'], ['audio', 'Audio trackFrançais']]);
    hud().triggerCaptionHud({ kind: 'dismiss' });
    await expect(lines()).toEqual([['audio', 'Audio trackFrançais']]);
  }
})));

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
    await expect(lines()).toEqual([['audio', 'Audio trackFrançais']]);
    stage().advance(LANGUAGE_MIN_VISIBLE_MS - 1);
    await expect(notice()?.classList.contains('fade-out')).toBe(false);
    stage().advance(1);
    await expect(notice()?.classList.contains('fade-out')).toBe(true);
  }
})));

test('A refused pick is its own line and the merged text is read once', () => runHudCase(hudStory(h => h.triggerCaptionHud(ON), {
  play: async () => {
    hud().updateLanguageHud({ ...AUDIO, audioRefused: { kind: 'status', title: "Couldn't switch audio track", detail: 'Deutsch' } });
    await expect(lines()).toEqual([['subtitles', 'Subtitles onEnglish'], ['audio', 'Audio trackFrançais'], ['audioRefused', "Couldn't switch audio trackDeutsch"]]);
    const region = getPlayerUiRoot().getElementById('theater-announcements')!;
    await vi.waitFor(() => expect(region.textContent).toBe("Subtitles on: English. Audio track: Français. Couldn't switch audio track: Deutsch"));
  }
})));

test('Reduce motion: lines join and resolve without animation', () => runHudCase({
  ...hudStory(h => h.triggerCaptionHud(LOADING), {
    play: async () => {
      stage().advance(LANGUAGE_LOAD_DELAY_MS);
      hud().updateLanguageHud(AUDIO);
      await expect(ownMotion(notice()!)).toEqual([]);
      hud().triggerCaptionHud(ON);
      await expect(notice()?.querySelector('.caption-hud-spinner')).toBeNull();
      await expect(ownMotion(notice()!)).toEqual([]);
      await expect(lines()).toEqual([['subtitles', 'Subtitles onEnglish'], ['audio', 'Audio trackFrançais']]);
    }
  }),
  globals: { reduceMotion: 'on' }
}));

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
    hud().updateLanguageHud({ audio: { kind: 'status', title: 'Audio track', detail: 'Deutsch' } });
    await expect(plates()).toBe(1);
    await expect(lines()).toEqual([['audio', 'Audio trackDeutsch']]);
  }
}) as HudCase));
