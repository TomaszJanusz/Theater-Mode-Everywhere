import type { StoryObj } from '@storybook/html-vite';

import type { AudioSettings } from '../src/audio-settings';
import { audioLevelLabelKey, AUDIO_HUD_KEYS } from '../src/audio-settings';
import { audioHudIcon, CENTERED_HUD_VISIBLE_MS, createHud } from '../src/ui/hud';
import { t } from '../src/ui/messages';
import { getPlayerUiRoot, queryPlayerUi } from '../src/ui/root';

import { activeAnimationCount, mountHudStage, uiNodeCount, type HudStage } from './hud-stage';

export type Phase = 'entering' | 'steady' | 'leaving';
export type Hud = ReturnType<typeof createHud>;

export interface HudArgs {
  /** Which part of the HUD's life the held frame shows. */
  phase: Phase;
  /** Run on the real clock and let animations play, as in the player. Not screenshot. */
  live: boolean;
}

export type HudStoryObj = StoryObj<HudArgs>;

export const OVERLAY = '.theater-everywhere-volume-overlay';
export const CAPTION_HUD = '.theater-everywhere-caption-hud';
export const SEEK = '.theater-everywhere-seek-overlay';

// Fraction of each animation's first iteration the held frame shows. The seek pulse is one long
// animation (fade in at 15%, fade out from 75%); the others are short enter animations and a fade.
const PHASE_PROGRESS: Record<Phase, number> = { entering: 0.5, steady: 1, leaving: 0.5 };
export const SEEK_PHASE_PROGRESS: Record<Phase, number> = { entering: 0.15, steady: 0.5, leaving: 0.9 };
/** Seek pulse: before the peak, mid-hold, fading out. */
export const SEEK_FRAMES = [0.15, 0.5, 0.9] as const;

let active: { stage: HudStage; hud: Hud } | undefined;
export const stage = (): HudStage => active!.stage;
export const hud = (): Hud => active!.hud;

export interface HudStoryOptions {
  boostReady?: boolean;
  progress?: Record<Phase, number>;
  /** Clock time the `leaving` phase advances to; centred HUDs leave after `CENTERED_HUD_VISIBLE_MS`. */
  leaveAfterMs?: number;
  /** Fractions the screenshots sweep, when the default 0, 50% and 100% miss the visible part of the motion. */
  frames?: readonly number[];
}

function renderHud(args: HudArgs, trigger: (hud: Hud, stage: HudStage) => void, options: HudStoryOptions): HTMLElement {
  const stage = mountHudStage({
    progress: args.live ? undefined : (options.progress ?? PHASE_PROGRESS)[args.phase],
    boostReady: options.boostReady,
    frames: options.frames
  });
  const hud = createHud(stage.host, () => {}, args.live ? undefined : stage.clock);
  stage.onDispose(() => { hud.removeCenteredHud(); hud.removeCaptionHud(); });
  active = { stage, hud };
  trigger(hud, stage);
  if (args.phase === 'leaving' && !args.live) stage.advance(options.leaveAfterMs ?? CENTERED_HUD_VISIBLE_MS);
  stage.settle();
  // Storybook mounts what a story returns; the HUD lives in the player UI shadow root.
  return document.createElement('div');
}

/** A story that triggers the production HUD once on a fresh stage; `play` then drives and asserts. */
export function hudStory(
  trigger: (hud: Hud, stage: HudStage) => void,
  story: HudStoryObj = {},
  options: HudStoryOptions = {}
): HudStoryObj {
  return { ...story, render: args => renderHud(args, trigger, options) };
}

export const overlay = (): HTMLElement | null => queryPlayerUi<HTMLElement>(OVERLAY);
export const overlayCount = (): number => getPlayerUiRoot().querySelectorAll(OVERLAY).length;
export const hudText = (): string | null | undefined => overlay()?.querySelector('.volume-hud-text')?.textContent;

/** What the HUDs leave behind: player UI elements, live animations and timers still pending. */
export function measure(): { nodes: number; animations: number; timers: number } {
  void document.documentElement.getBoundingClientRect();
  return { nodes: uiNodeCount(), animations: activeAnimationCount(), timers: stage().clock.pending };
}

/** The bass confirmation as the cycle command shows it: the label, the icon and the confirmed level. */
export function bassHud(bass: AudioSettings['bass']): (hud: Hud) => void {
  const settings: AudioSettings = { voice: 'off', leveling: 'off', bass };
  return hud => hud.triggerStatusIndicator(
    t(AUDIO_HUD_KEYS.bass, t(audioLevelLabelKey(settings, 'bass'))), audioHudIcon('bass', settings), bass
  );
}
