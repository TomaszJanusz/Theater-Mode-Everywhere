import { expect, test } from 'vitest';


import { CAPTION_LOADING_HUD_DELAY_MS, type CaptionHudView } from '../../src/ui/hud';
import { t } from '../../src/ui/messages';
import { queryPlayerUi } from '../../src/ui/root';
import { hudCase as hudStory, runHudCase, type HudCase } from '../fixture-test';
import { CAPTION_HUD } from '../hud-story';
import type { hud } from '../hud-story';


type Story = HudCase;

// The runtime maps each caption result to one of these views (`showCaptionHud` in player-runtime.ts).
const loading = (): CaptionHudView => ({ kind: 'loading', title: t('subtitlesLoadingHud') });
const status = (key: string, detail?: string, duration?: number): CaptionHudView => ({
  kind: 'status', title: t(key), ...(detail ? { detail } : {}), ...(duration ? { duration } : {})
});

const hud_ = () => queryPlayerUi<HTMLElement>(CAPTION_HUD);
const title = () => hud_()?.querySelector('.volume-hud-text')?.textContent;
const detail = () => hud_()?.querySelector('.volume-hud-detail')?.textContent;
// Status notices show 800 ms by default; the `leaving` frame sits in the fade after that.
const STATUS_VISIBLE_MS = 800;

// Views are built when the story renders, after the locale global has loaded its catalog.
const show = (view: () => CaptionHudView, afterMs = 0) => (h: ReturnType<typeof hud>, stage: { advance(ms: number): void }) => {
  h.triggerCaptionHud(view());
  if (afterMs) stage.advance(afterMs);
};

/** A loading notice appears only after a short delay, so a fast download never flashes it. */
const Loading: Story = hudStory(show(loading, CAPTION_LOADING_HUD_DELAY_MS), {
  play: async () => {
    await expect(title()).toBe(t('subtitlesLoadingHud'));
    await expect(hud_()?.classList.contains('loading')).toBe(true);
    await expect(hud_()?.querySelector('.caption-hud-spinner')).not.toBeNull();
  }
});
test('Loading', () => runHudCase(Loading));

const CaptionsOff: Story = hudStory(show(() => status('subtitlesOffHud')), {
  play: async () => { await expect(title()).toBe(t('subtitlesOffHud')); }
}, { leaveAfterMs: STATUS_VISIBLE_MS });
test('CaptionsOff', () => runHudCase(CaptionsOff));

const NoCaptionsAvailable: Story = hudStory(show(() => status('noSubtitlesAvailable')), {
  play: async () => { await expect(title()).toBe(t('noSubtitlesAvailable')); }
}, { leaveAfterMs: STATUS_VISIBLE_MS });
test('NoCaptionsAvailable', () => runHudCase(NoCaptionsAvailable));

const LoadFailed: Story = hudStory(show(() => status('subtitlesLoadFailedHud')), {
  play: async () => { await expect(title()).toBe(t('subtitlesLoadFailedHud')); }
}, { leaveAfterMs: STATUS_VISIBLE_MS });
test('LoadFailed', () => runHudCase(LoadFailed));

const CaptionsOnWithLanguage: Story = hudStory(show(() => status('subtitlesOnHud', 'English (auto-generated)', 4000)), {
  play: async () => {
    await expect(title()).toBe(t('subtitlesOnHud'));
    await expect(detail()).toBe('English (auto-generated)');
  }
}, { leaveAfterMs: 4000 });
test('CaptionsOnWithLanguage', () => runHudCase(CaptionsOnWithLanguage));

/** Loading turns into the result in the same plate: the ring zooms out and the width eases to the new text. */
const LoadingBecomesResult: Story = hudStory((h, stage) => {
  h.triggerCaptionHud(loading());
  stage.advance(CAPTION_LOADING_HUD_DELAY_MS);
  h.triggerCaptionHud(status('subtitlesOnHud', 'Deutsch', 4000));
}, {
  play: async () => {
    await expect(title()).toBe(t('subtitlesOnHud'));
    await expect(detail()).toBe('Deutsch');
  }
});
test('LoadingBecomesResult', () => runHudCase(LoadingBecomesResult));

const LongLabelGerman: Story = {
  ...hudStory(show(() => status('subtitlesOnHud', 'Portugiesisch (Brasilien, automatisch erstellt)', 4000)), {
    play: async () => { await expect(title()).toBe(t('subtitlesOnHud')); }
  }, { leaveAfterMs: 4000 }),
  globals: { locale: 'de' }
};
test('LongLabelGerman', () => runHudCase(LongLabelGerman));

const RtlArabic: Story = {
  ...hudStory(show(() => status('subtitlesOnHud', 'العربية', 4000)), {
    play: async () => { await expect(hud_()?.getAttribute('dir')).toBe('rtl'); }
  }, { leaveAfterMs: 4000 }),
  globals: { locale: 'ar' }
};
test('RtlArabic', () => runHudCase(RtlArabic));
