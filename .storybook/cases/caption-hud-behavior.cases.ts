import { expect, test } from 'vitest';


import { CAPTION_LOADING_HUD_DELAY_MS, HUD_FADE_OUT_MS, type CaptionHudView } from '../../src/ui/hud';
import { t } from '../../src/ui/messages';
import { queryPlayerUi } from '../../src/ui/root';
import { hudCase as hudStory, runHudCase, type HudCase } from '../fixture-test';
import { activeAnimationCount, uiNodeCount } from '../hud-stage';
import { CAPTION_HUD, hud, measure, stage } from '../hud-story';

// Lifecycle of the caption notice on a clock the story advances; the frames are in `Components/Caption notice`.

type Story = HudCase;

// Animations still alive depend on how far real time has run, so the bound is a ceiling for the plates
// the burst can leave (at most both seek overlays: three arrows and the pulse each), not a count.
const MAX_PLATE_ANIMATIONS = 8;

const LOADING: CaptionHudView = { kind: 'loading', title: 'Loading' };
const status = (title: string, detail?: string, duration?: number): CaptionHudView =>
  ({ kind: 'status', title, ...(detail ? { detail } : {}), ...(duration ? { duration } : {}) });
const notice = () => queryPlayerUi<HTMLElement>(CAPTION_HUD);

/** A download that finishes inside the delay never shows anything and leaves no timer. */
const FastLoadNeverFlashes: Story = hudStory(h => h.triggerCaptionHud(LOADING), {
  play: async () => {
    stage().advance(CAPTION_LOADING_HUD_DELAY_MS - 1);
    await expect(notice()).toBeNull();
    hud().triggerCaptionHud({ kind: 'dismiss' });
    stage().advance(CAPTION_LOADING_HUD_DELAY_MS);
    await expect(notice()).toBeNull();
    await expect(stage().clock.pending).toBe(0);
  }
});
test('FastLoadNeverFlashes', () => runHudCase(FastLoadNeverFlashes));

const LoadingStaysUntilDone: Story = hudStory(h => h.triggerCaptionHud(LOADING), {
  play: async () => {
    stage().advance(CAPTION_LOADING_HUD_DELAY_MS);
    const shown = notice()!;
    stage().advance(60_000);
    await expect(notice()).toBe(shown);
    await expect(shown.classList.contains('fade-out')).toBe(false);
    hud().triggerCaptionHud({ kind: 'dismiss' });
    await expect(notice()).toBeNull();
  }
});
test('LoadingStaysUntilDone', () => runHudCase(LoadingStaysUntilDone));

const StatusHidesAfterDuration: Story = hudStory(h => h.triggerCaptionHud(status('Captions off')), {
  play: async () => {
    const shown = notice()!;
    stage().advance(799);
    await expect(shown.classList.contains('fade-out')).toBe(false);
    stage().advance(1);
    await expect(shown.classList.contains('fade-out')).toBe(true);
    stage().advance(HUD_FADE_OUT_MS);
    await expect(shown.isConnected).toBe(false);
    await expect(stage().clock.pending).toBe(0);
  }
});
test('StatusHidesAfterDuration', () => runHudCase(StatusHidesAfterDuration));

const StatusDurationIsHonoured: Story = hudStory(h => h.triggerCaptionHud(status(t('subtitlesOnHud'), 'English', 4000)), {
  play: async () => {
    stage().advance(3999);
    await expect(notice()?.classList.contains('fade-out')).toBe(false);
    stage().advance(1);
    await expect(notice()?.classList.contains('fade-out')).toBe(true);
  }
});
test('StatusDurationIsHonoured', () => runHudCase(StatusDurationIsHonoured));

/** A second status while one shows rewrites the same plate and restarts its timer. */
const RetriggerResetsTimer: Story = hudStory(h => h.triggerCaptionHud(status('Captions off')), {
  play: async () => {
    const shown = notice()!;
    stage().advance(700);
    hud().triggerCaptionHud(status('Captions on', 'English'));
    await expect(notice()).toBe(shown);
    await expect(shown.querySelector('.volume-hud-text')?.textContent).toBe('Captions on');
    await expect(stage().clock.pending).toBe(1);
    stage().advance(799);
    await expect(shown.classList.contains('fade-out')).toBe(false);
    stage().advance(1);
    await expect(shown.classList.contains('fade-out')).toBe(true);
  }
});
test('RetriggerResetsTimer', () => runHudCase(RetriggerResetsTimer));

/** Work for an earlier media or session must not show, hide or remove anything for a later one. */
const StaleLoadingNeverShows: Story = hudStory(h => h.triggerCaptionHud(LOADING), {
  play: async () => {
    stage().session.currentEpoch += 1;
    stage().advance(CAPTION_LOADING_HUD_DELAY_MS);
    await expect(notice()).toBeNull();
  }
});
test('StaleLoadingNeverShows', () => runHudCase(StaleLoadingNeverShows));

const StaleStatusDoesNotFade: Story = hudStory(h => h.triggerCaptionHud(status('Captions off')), {
  play: async () => {
    const shown = notice()!;
    stage().session.element = document.createElement('video');
    stage().advance(5000);
    await expect(shown.classList.contains('fade-out')).toBe(false);
    hud().removeCaptionHud();
    await expect(shown.isConnected).toBe(false);
  }
});
test('StaleStatusDoesNotFade', () => runHudCase(StaleStatusDoesNotFade));

const NoSessionNoNotice: Story = hudStory((h, s) => {
  s.session.element = null;
  h.triggerCaptionHud(status('Captions off'));
  h.triggerCaptionHud(LOADING);
}, {
  play: async () => {
    stage().advance(CAPTION_LOADING_HUD_DELAY_MS);
    await expect(notice()).toBeNull();
    await expect(stage().clock.pending).toBe(0);
  }
});
test('NoSessionNoNotice', () => runHudCase(NoSessionNoNotice));

const CleanupLeavesNothing: Story = hudStory((h, s) => {
  h.triggerCaptionHud(LOADING);
  s.advance(CAPTION_LOADING_HUD_DELAY_MS);
  h.triggerCaptionHud(status('Captions on', 'English', 4000));
}, {
  play: async () => {
    hud().removeCaptionHud();
    hud().removeCaptionHud();
    await expect(uiNodeCount()).toBe(0);
    await expect(stage().clock.pending).toBe(0);
    await expect(activeAnimationCount()).toBe(0);
  }
});
test('CleanupLeavesNothing', () => runHudCase(CleanupLeavesNothing));

const RapidResults: Story = hudStory(() => {}, {
  play: async () => {
    const run = (index: number) => hud().triggerCaptionHud(index % 2
      ? status('Captions on', `Language ${index}`, 4000) : status('Captions off'));
    run(0);
    run(1);
    const one = measure();
    for (let index = 2; index < 200; index++) run(index);
    const many = measure();
    console.info(`[hud-rapid] caption: 2 actions ${JSON.stringify(one)}; 200 actions ${JSON.stringify(many)}`);
    await expect(many.nodes).toBe(one.nodes);
    await expect(many.animations).toBeLessThanOrEqual(MAX_PLATE_ANIMATIONS);
    await expect(many.timers).toBe(one.timers);
  }
});
test('RapidResults', () => runHudCase(RapidResults));

// Completion before the delay must cancel the pending loader, including when it becomes a status.
test('Status before loading delay cancels the pending spinner', () => runHudCase(hudStory(h => h.triggerCaptionHud(LOADING), {
  play: async () => {
    stage().advance(100);
    hud().triggerCaptionHud(status('Failed'));
    stage().advance(CAPTION_LOADING_HUD_DELAY_MS);
    await expect(notice()?.querySelector('.caption-hud-spinner')).toBeNull();
    await expect(notice()?.textContent).toBe('Failed');
  }
})));
