import { expect, test } from 'vitest';


import type { CaptionHudView } from '../../src/ui/language-hud';
import { LANGUAGE_MIN_VISIBLE_MS, LANGUAGE_LOAD_DELAY_MS } from '../../src/ui/language-notice';
import { t } from '../../src/ui/messages';
import { queryPlayerUi } from '../../src/ui/root';
import { hudCase as hudStory, runHudCase, type HudCase } from '../fixture-test';
import { CAPTION_HUD } from '../hud-story';
import type { hud } from '../hud-story';


type Story = HudCase;

// The runtime maps each caption result to one of these views (`showCaptionHud` in player-runtime.ts).
const loading = (): CaptionHudView => ({ kind: 'loading', title: t('subtitlesMenuTitle'), detail: t('loadingLabel') });
const status = (detail: string): CaptionHudView => ({ kind: 'status', title: t('subtitlesMenuTitle'), detail });

const hud_ = () => queryPlayerUi<HTMLElement>(CAPTION_HUD);
const title = () => hud_()?.querySelector('.language-hud-label')?.textContent;
/** The value as it reads once any spinner has gone: the value text, or "Loading..." while it loads. */
const detail = () => (hud_()?.querySelector('.language-hud-text') ?? hud_()?.querySelector('.language-hud-loading-text'))?.textContent;

// Views are built when the story renders, after the locale global has loaded its catalog.
const show = (view: () => CaptionHudView, afterMs = 0) => (h: ReturnType<typeof hud>, stage: { advance(ms: number): void }) => {
  h.triggerCaptionHud(view());
  if (afterMs) stage.advance(afterMs);
};

/** A loading notice appears only after a short delay, so a fast download never flashes it. */
const Loading: Story = hudStory(show(loading, LANGUAGE_LOAD_DELAY_MS), {
  play: async () => {
    await expect(title()).toBe(t('subtitlesMenuTitle'));
    await expect(detail()).toBe(t('loadingLabel'));
    await expect(hud_()?.querySelector('[data-language-line="subtitles"] .language-hud-value .language-hud-spinner')).not.toBeNull();
  }
});
test('Loading', () => runHudCase(Loading));

const CaptionsOff: Story = hudStory(show(() => status(t('subtitlesOff'))), {
  play: async () => { await expect(detail()).toBe(t('subtitlesOff')); }
}, { leaveAfterMs: LANGUAGE_MIN_VISIBLE_MS });
test('CaptionsOff', () => runHudCase(CaptionsOff));

const NoCaptionsAvailable: Story = hudStory(show(() => status(t('subtitlesHudNone'))), {
  play: async () => { await expect(detail()).toBe(t('subtitlesHudNone')); }
}, { leaveAfterMs: LANGUAGE_MIN_VISIBLE_MS });
test('NoCaptionsAvailable', () => runHudCase(NoCaptionsAvailable));

const LoadFailed: Story = hudStory(show(() => status(t('subtitlesHudFailed'))), {
  play: async () => { await expect(detail()).toBe(t('subtitlesHudFailed')); }
}, { leaveAfterMs: LANGUAGE_MIN_VISIBLE_MS });
test('LoadFailed', () => runHudCase(LoadFailed));

const CaptionsOnWithLanguage: Story = hudStory(show(() => status('English (auto-generated)')), {
  play: async () => {
    await expect(title()).toBe(t('subtitlesMenuTitle'));
    await expect(detail()).toBe('English (auto-generated)');
  }
}, { leaveAfterMs: LANGUAGE_MIN_VISIBLE_MS });
test('CaptionsOnWithLanguage', () => runHudCase(CaptionsOnWithLanguage));

/** Loading turns into the result in the same plate: the ring zooms out and the width eases to the new text. */
const LoadingBecomesResult: Story = hudStory((h, stage) => {
  h.triggerCaptionHud(loading());
  stage.advance(LANGUAGE_LOAD_DELAY_MS);
  h.triggerCaptionHud(status('Deutsch'));
}, {
  play: async () => {
    await expect(title()).toBe(t('subtitlesMenuTitle'));
    await expect(detail()).toBe('Deutsch');
  }
});
test('LoadingBecomesResult', () => runHudCase(LoadingBecomesResult));

const LongLabelGerman: Story = {
  ...hudStory(show(() => status('Portugiesisch (Brasilien, automatisch erstellt)')), {
    play: async () => { await expect(title()).toBe(t('subtitlesMenuTitle')); }
  }, { leaveAfterMs: LANGUAGE_MIN_VISIBLE_MS }),
  globals: { locale: 'de' }
};
test('LongLabelGerman', () => runHudCase(LongLabelGerman));

const RtlArabic: Story = {
  ...hudStory(show(() => status('العربية')), {
    play: async () => { await expect(hud_()?.getAttribute('dir')).toBe('rtl'); }
  }, { leaveAfterMs: LANGUAGE_MIN_VISIBLE_MS }),
  globals: { locale: 'ar' }
};
test('RtlArabic', () => runHudCase(RtlArabic));
