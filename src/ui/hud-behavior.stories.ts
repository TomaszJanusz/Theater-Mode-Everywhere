import type { Meta } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import { activeAnimationCount, uiNodeCount } from '../../.storybook/hud-stage';
import {
  bassHud, hud, hudStory, hudText, measure, overlay, overlayCount, SEEK, SEEK_PHASE_PROGRESS, stage, type HudArgs, type HudStoryObj
} from '../../.storybook/hud-story';
import { BASS_LEVELS } from '../audio-settings';

import {
  audioHudIcon, CENTERED_HUD_VISIBLE_MS, HUD_FADE_OUT_MS, SEEK_HUD_MS, STATUS_HUD_MUTE_ICON
} from './hud';
import { t } from './messages';
import { queryPlayerUi } from './root';

// Behavior of the HUD lifecycle on a clock the story advances. These end with the UI removed or
// replaced, so they are not screenshot; `Player/HUD` has the frames.
const meta: Meta<HudArgs> = {
  title: 'Player/HUD behavior',
  globals: { reduceMotion: 'off' },
  tags: ['no-shot'],
  args: { phase: 'steady', live: false }
};
export default meta;

type Story = HudStoryObj;

// Animations still alive depend on how far real time has run, so the bound is a ceiling for the plates
// the burst can leave (at most both seek overlays: three arrows and the pulse each), not a count.
const MAX_PLATE_ANIMATIONS = 8;

const RAPID_ACTIONS = 200;

/** Fires `action` many times with no time passing, the way a held key repeats, and reports what it left. */
function rapid(name: string, action: (index: number) => void): { one: ReturnType<typeof measure>; many: ReturnType<typeof measure> } {
  // The first pair covers both variants of an alternating action; an even total ends on the same one.
  action(0);
  action(1);
  const one = measure();
  for (let index = 2; index < RAPID_ACTIONS; index++) action(index);
  const many = measure();
  console.info(`[hud-rapid] ${name}: 2 actions ${JSON.stringify(one)}; ${RAPID_ACTIONS} actions ${JSON.stringify(many)}`);
  return { one, many };
}

/** A click previews its action and the command then reports the same one: no second icon. */
export const PlaybackEchoKeepsTheIcon: Story = hudStory(hud => hud.triggerPlaybackIndicator('play'), {
  play: async () => {
    const first = overlay()!;
    const icon = first.querySelector('.volume-hud-icon');
    stage().advance(2000);
    hud().triggerPlaybackIndicator('play');
    await expect(overlay()).toBe(first);
    await expect(first.querySelector('.volume-hud-icon')).toBe(icon);
    // The echo restarted the timer: the original would have faded 800 ms from now.
    stage().advance(CENTERED_HUD_VISIBLE_MS - 1);
    await expect(first.classList.contains('fade-out')).toBe(false);
    stage().advance(1);
    await expect(first.classList.contains('fade-out')).toBe(true);
  }
});

export const CancelledClickWithdraws: Story = hudStory(hud => hud.triggerPlaybackIndicator('pause'), {
  play: async () => {
    hud().dismissPlaybackIndicator();
    await expect(overlay()).toBeNull();
    await expect(stage().clock.pending).toBe(0);
  }
});

/** The pulse ends by itself: its timer removes the node, and a repeat in the same direction replaces it. */
export const SeekPulseLeavesRepeat: Story = hudStory(hud => hud.triggerSeekIndicator('right'), {
  play: async () => {
    const first = queryPlayerUi(`${SEEK}.right`)!;
    stage().advance(SEEK_HUD_MS / 2);
    hud().triggerSeekIndicator('right');
    const second = queryPlayerUi(`${SEEK}.right`)!;
    await expect(second).not.toBe(first);
    await expect(first.isConnected).toBe(false);
    // The first node's timer fires into a node that is already gone and must not touch the second.
    stage().advance(SEEK_HUD_MS / 2);
    await expect(second.isConnected).toBe(true);
    stage().advance(SEEK_HUD_MS / 2);
    await expect(second.isConnected).toBe(false);
    await expect(stage().clock.pending).toBe(0);
  }
}, { progress: SEEK_PHASE_PROGRESS });

export const BassLevelsInOrder: Story = hudStory(bassHud('less'), {
  play: async () => {
    await expect([...BASS_LEVELS]).toEqual(['less', 'original', 'more', 'moar', 'moaaarr']);
    for (const level of BASS_LEVELS) {
      bassHud(level)(hud());
      await expect(overlayCount()).toBe(1);
      await expect(overlay()?.dataset.level).toBe(level);
    }
  }
});

export const HidesAfterItsTimeout: Story = hudStory(hud => hud.triggerStatusIndicator(t('muteHud'), STATUS_HUD_MUTE_ICON), {
  play: async () => {
    const shown = overlay()!;
    stage().advance(CENTERED_HUD_VISIBLE_MS - 1);
    await expect(shown.classList.contains('fade-out')).toBe(false);
    stage().advance(1);
    await expect(shown.classList.contains('fade-out')).toBe(true);
    await expect(shown.isConnected).toBe(true);
    stage().advance(HUD_FADE_OUT_MS);
    await expect(shown.isConnected).toBe(false);
    await expect(stage().clock.pending).toBe(0);
  }
});

export const RetriggerResetsTimer: Story = hudStory(hud => hud.triggerVolumeIndicator(0.5, false, 'up'), {
  play: async () => {
    const shown = overlay()!;
    stage().advance(CENTERED_HUD_VISIBLE_MS - 100);
    hud().triggerVolumeIndicator(0.55, false, 'up');
    await expect(overlay()).toBe(shown);
    await expect(hudText()).toBe('55%');
    await expect(stage().clock.pending).toBe(1);
    stage().advance(CENTERED_HUD_VISIBLE_MS - 1);
    await expect(shown.classList.contains('fade-out')).toBe(false);
    stage().advance(1);
    await expect(shown.classList.contains('fade-out')).toBe(true);
  }
});

/** A new action while the old one fades revives the same plate instead of removing it mid-fade. */
export const RetriggerWhileLeaving: Story = hudStory(hud => hud.triggerVolumeIndicator(0.5, false, 'up'), {
  play: async () => {
    const shown = overlay()!;
    stage().advance(CENTERED_HUD_VISIBLE_MS);
    await expect(shown.classList.contains('fade-out')).toBe(true);
    hud().triggerVolumeIndicator(0.6, false, 'up');
    await expect(overlay()).toBe(shown);
    await expect(shown.classList.contains('fade-out')).toBe(false);
    // The pending removal was cancelled with the old timers.
    stage().advance(HUD_FADE_OUT_MS);
    await expect(shown.isConnected).toBe(true);
  }
});

export const OneOverlayAcrossActions: Story = hudStory(hud => hud.triggerPlaybackIndicator('play'), {
  play: async () => {
    const shown = overlay()!;
    hud().triggerVolumeIndicator(0.4, false, 'down');
    hud().triggerStatusIndicator(t('muteHud'), STATUS_HUD_MUTE_ICON);
    await expect(overlayCount()).toBe(1);
    await expect(overlay()).toBe(shown);
    await expect(shown.dataset.playbackAction).toBeUndefined();
    await expect(hudText()).toBe(t('muteHud'));
  }
});

/** Work scheduled for an earlier session must not touch the UI of a later one. */
export const StaleSessionIgnored: Story = hudStory(hud => hud.triggerVolumeIndicator(0.5, false, 'up'), {
  play: async () => {
    const shown = overlay()!;
    stage().session.currentEpoch += 1;
    stage().advance(CENTERED_HUD_VISIBLE_MS + HUD_FADE_OUT_MS);
    await expect(shown.classList.contains('fade-out')).toBe(false);
    await expect(shown.isConnected).toBe(true);
    // Theater exit still removes it.
    hud().removeCenteredHud();
    await expect(shown.isConnected).toBe(false);
  }
});

export const NoSessionNoHud: Story = hudStory((hud, stage) => {
  stage.session.element = null;
  hud.triggerVolumeIndicator(0.5, false, 'up');
  hud.triggerStatusIndicator('x', '');
  hud.triggerPlaybackIndicator('play');
  hud.triggerSeekIndicator('left');
}, {
  play: async () => {
    await expect(overlay()).toBeNull();
    await expect(queryPlayerUi(SEEK)).toBeNull();
    await expect(stage().clock.pending).toBe(0);
  }
});

/** Theater exit: nodes, timers and animations all go, and a second exit is harmless. */
export const CleanupLeavesNothing: Story = hudStory(hud => {
  hud.triggerVolumeIndicator(0.5, false, 'up');
  hud.triggerSeekIndicator('left');
}, {
  play: async () => {
    hud().removeCenteredHud();
    hud().removeCenteredHud();
    stage().advance(SEEK_HUD_MS);
    await expect(uiNodeCount()).toBe(0);
    await expect(stage().clock.pending).toBe(0);
    await expect(activeAnimationCount()).toBe(0);
  }
}, { progress: SEEK_PHASE_PROGRESS });

export const RapidVolume: Story = hudStory(() => {}, {
  play: async () => {
    const { one, many } = rapid('volume', index => hud().triggerVolumeIndicator(index % 2 ? 0.8 : 0.6, false, index % 2 ? 'down' : 'up'));
    await expect(many.nodes).toBe(one.nodes);
    await expect(many.animations).toBeLessThanOrEqual(MAX_PLATE_ANIMATIONS);
    await expect(many.timers).toBe(one.timers);
    stage().advance(CENTERED_HUD_VISIBLE_MS + HUD_FADE_OUT_MS);
    await expect(uiNodeCount()).toBe(0);
    await expect(stage().clock.pending).toBe(0);
  }
});

export const RapidStatus: Story = hudStory(() => {}, {
  play: async () => {
    const { one, many } = rapid('status', index => {
      const bass = index % 2 ? 'more' : 'moaaarr';
      hud().triggerStatusIndicator(`Bass: ${index}`, audioHudIcon('bass', { voice: 'off', leveling: 'off', bass }), bass);
    });
    await expect(many.nodes).toBe(one.nodes);
    await expect(many.animations).toBeLessThanOrEqual(MAX_PLATE_ANIMATIONS);
    await expect(many.timers).toBe(one.timers);
  }
});

export const RapidPlayPause: Story = hudStory(() => {}, {
  play: async () => {
    const { one, many } = rapid('play-pause', index => hud().triggerPlaybackIndicator(index % 2 ? 'pause' : 'play'));
    await expect(many.nodes).toBe(one.nodes);
    await expect(many.animations).toBeLessThanOrEqual(MAX_PLATE_ANIMATIONS);
    await expect(many.timers).toBe(one.timers);
  }
});

/**
 * Nodes stay at one per direction. Each seek also leaves its own 650 ms removal timer behind (the
 * replaced node's timer is not cleared), so pending timers grow with the burst and drain with the clock.
 */
export const RapidSeek: Story = hudStory(() => {}, {
  play: async () => {
    const { one, many } = rapid('seek', index => hud().triggerSeekIndicator(index % 2 ? 'left' : 'right'));
    await expect(many.nodes).toBeLessThanOrEqual(one.nodes * 2);
    await expect(many.animations).toBeLessThanOrEqual(MAX_PLATE_ANIMATIONS);
    await expect(many.timers).toBe(RAPID_ACTIONS);
    stage().advance(SEEK_HUD_MS);
    await expect(uiNodeCount()).toBe(0);
    await expect(stage().clock.pending).toBe(0);
  }
}, { progress: SEEK_PHASE_PROGRESS });

