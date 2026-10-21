import type { Meta } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import { bassHud, hudStory, hudText, overlay, SEEK, SEEK_FRAMES, SEEK_PHASE_PROGRESS, type HudArgs } from '../../.storybook/hud-story';
import { BASS_LEVELS, type AudioSettings } from '../audio-settings';

import { videoFitLabel } from './appearance';
import { CONTROLS_VISIBILITY_ICON } from './controls-visibility';
import {
  STATUS_HUD_FIT_ICON, STATUS_HUD_LAYOUT_ICON, STATUS_HUD_MUTE_ICON, STATUS_HUD_SWITCH_ICON,
  STATUS_HUD_UNMUTE_ICON, VOLUME_BOOST_ICONS
} from './hud';
import { t } from './messages';
import { getPlayerUiRoot, queryPlayerUi } from './root';

const meta: Meta<HudArgs> = {
  title: 'Player/HUD', tags: ['frames'], args: { phase: 'steady', live: false },
  argTypes: {
    phase: { control: 'select', options: ['entering', 'steady', 'leaving'] },
    live: { control: 'boolean', description: 'Real-clock preview; replay remounts the fixture.' }
  }
};
export default meta;

function playback(action: 'play' | 'pause') {
  return hudStory<HudArgs & { action: 'play' | 'pause' }>((h, _s, args) => h.triggerPlaybackIndicator(args.action), {
    args: { action }, argTypes: { action: { control: 'select', options: ['play', 'pause'] } },
    play: async ({ args }) => {
      await expect(hudText()).toBe(t(args.action));
      await expect(overlay()?.dataset.playbackAction).toBe(args.action);
    }
  });
}

interface VolumeArgs extends HudArgs { amount: number; muted: boolean; direction: 'up' | 'down'; graph: boolean }
function volume(amount: number, direction: 'up' | 'down' = 'up', graph = false, muted = false) {
  return hudStory<VolumeArgs>((h, s, args) => {
    s.session.element!.dataset.theaterBoostReady = String(args.graph);
    h.triggerVolumeIndicator(args.amount, args.muted, args.direction);
  }, {
    args: { amount, direction, graph, muted },
    argTypes: {
      amount: { control: { type: 'range', min: 0, max: 1.5, step: 0.05 } },
      muted: { control: 'boolean' }, graph: { control: 'boolean' },
      direction: { control: 'select', options: ['up', 'down'] }
    },
    play: async ({ args }) => {
      const level = args.muted ? 0 : args.amount;
      await expect(hudText()).toBe(`${Math.round(level <= 1 ? level * 100 : 100 + (level - 1) * 400)}%`);
      await expect(overlay()?.classList.contains('boosted')).toBe(level > 1 && args.graph);
      await expect(overlay()?.querySelector('.volume-hud-text')?.classList.contains(args.direction === 'up' ? 'zoom-in' : 'zoom-out')).toBe(true);
    }
  });
}

function seek(direction: 'left' | 'right' | 'both') {
  return hudStory<HudArgs & { direction: 'left' | 'right' | 'both' }>((h, _s, args) => {
    if (args.direction !== 'right') h.triggerSeekIndicator('left');
    if (args.direction !== 'left') h.triggerSeekIndicator('right');
  }, {
    args: { direction }, argTypes: { direction: { control: 'select', options: ['left', 'right', 'both'] } },
    play: async ({ args }) => {
      await expect(getPlayerUiRoot().querySelectorAll(SEEK).length).toBe(args.direction === 'both' ? 2 : 1);
      for (const side of args.direction === 'both' ? ['left', 'right'] : [args.direction]) {
        await expect(queryPlayerUi(`${SEEK}.${side}`)?.textContent).toBe(t('fiveSeconds'));
        await expect(queryPlayerUi(`${SEEK}.${side}`)?.getAttribute('dir')).toBe(t('@@bidi_dir'));
      }
    }
  }, { progress: SEEK_PHASE_PROGRESS, frames: SEEK_FRAMES });
}

const STATUS = {
  mute: () => [t('muteHud'), STATUS_HUD_MUTE_ICON],
  unmute: () => [t('unmuteHud'), STATUS_HUD_UNMUTE_ICON],
  boost: () => [t('volumeBoostHud', t('volumeBoostOn')), VOLUME_BOOST_ICONS.hud],
  fit: () => [videoFitLabel('cover'), STATUS_HUD_FIT_ICON],
  alignment: () => [t('pictureAlignTop'), STATUS_HUD_LAYOUT_ICON],
  switch: () => [t('cycleIframeHud'), STATUS_HUD_SWITCH_ICON],
  pinned: () => [t('controlsPinnedHud'), CONTROLS_VISIBILITY_ICON],
  unavailable: () => [t('nativeChatFullscreenUnavailable'), ''],
  onlyVideo: () => [t('onlyOneVideoHud'), STATUS_HUD_SWITCH_ICON]
};
function status(preset: keyof typeof STATUS) {
  return hudStory<HudArgs & { preset: keyof typeof STATUS }>((h, _s, args) => {
    const [text, icon] = STATUS[args.preset]();
    h.triggerStatusIndicator(text, icon);
  }, {
    args: { preset }, argTypes: { preset: { control: 'select', options: Object.keys(STATUS) } },
    play: async ({ args }) => {
      await expect(hudText()).toBe(STATUS[args.preset]()[0]);
      if (args.preset === 'unavailable') await expect(overlay()?.querySelector('.volume-hud-icon svg')).toBeNull();
    }
  });
}
function bass(level: AudioSettings['bass']) {
  return hudStory<HudArgs & { level: AudioSettings['bass'] }>((h, _s, args) => bassHud(args.level)(h), {
    args: { level }, argTypes: { level: { control: 'select', options: BASS_LEVELS } },
    play: async ({ args }) => {
      await expect(overlay()?.dataset.level).toBe(args.level);
      await expect(overlay()?.querySelector('.bass-icon')?.getAttribute('data-level')).toBe(args.level);
    }
  });
}

export const Playback = playback('play');
export const Volume = volume(0.65);
export const BoostedVolume = volume(1.25, 'up', true);
export const VolumeWithoutGraph = volume(1.25);
export const Seek = seek('right');
export const SeekBoth = seek('both');
export const Status = status('mute');
export const TextOnly = status('unavailable');
export const Bass = bass('moaaarr');
