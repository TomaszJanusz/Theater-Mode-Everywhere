import type { Meta } from '@storybook/html-vite';
import { expect } from 'storybook/test';

import {
  bassHud, hudStory, hudText, overlay, SEEK, SEEK_FRAMES, SEEK_PHASE_PROGRESS, type HudArgs, type HudStoryObj
} from '../../.storybook/hud-story';
import type { AudioSettings } from '../audio-settings';

import { videoFitLabel } from './appearance';
import { CONTROLS_VISIBILITY_ICON } from './controls-visibility';
import {
  STATUS_HUD_FIT_ICON, STATUS_HUD_LAYOUT_ICON, STATUS_HUD_MUTE_ICON, STATUS_HUD_SWITCH_ICON,
  STATUS_HUD_UNMUTE_ICON, VOLUME_BOOST_ICONS
} from './hud';
import { t } from './messages';
import { getPlayerUiRoot, queryPlayerUi } from './root';

const meta: Meta<HudArgs> = {
  title: 'Player/HUD',
  globals: { reduceMotion: 'off' },
  tags: ['frames'],
  args: { phase: 'steady', live: false }
};
export default meta;

type Story = HudStoryObj;

export const Play: Story = hudStory(hud => hud.triggerPlaybackIndicator('play'), {
  play: async () => {
    await expect(hudText()).toBe(t('play'));
    await expect(overlay()?.dataset.playbackAction).toBe('play');
  }
});

export const Pause: Story = hudStory(hud => hud.triggerPlaybackIndicator('pause'), {
  play: async () => {
    await expect(hudText()).toBe(t('pause'));
  }
});

export const VolumeUp: Story = hudStory(hud => hud.triggerVolumeIndicator(0.65, false, 'up'), {
  play: async () => {
    await expect(hudText()).toBe('65%');
    await expect(overlay()?.querySelector('.volume-hud-text')?.classList.contains('zoom-in')).toBe(true);
  }
});

export const VolumeDown: Story = hudStory(hud => hud.triggerVolumeIndicator(0.3, false, 'down'), {
  play: async () => {
    await expect(hudText()).toBe('30%');
    await expect(overlay()?.querySelector('.volume-hud-text')?.classList.contains('zoom-out')).toBe(true);
  }
});

export const VolumeFull: Story = hudStory(hud => hud.triggerVolumeIndicator(1, false, 'up'), {
  play: async () => { await expect(hudText()).toBe('100%'); }
});

export const VolumeZero: Story = hudStory(hud => hud.triggerVolumeIndicator(0, false, 'down'), {
  play: async () => { await expect(hudText()).toBe('0%'); }
});

export const VolumeMuted: Story = hudStory(hud => hud.triggerVolumeIndicator(0.8, true, 'down'), {
  play: async () => { await expect(hudText()).toBe('0%'); }
});

export const VolumeBoosted: Story = hudStory(hud => hud.triggerVolumeIndicator(1.25, false, 'up'), {
  play: async () => {
    await expect(hudText()).toBe('200%');
    await expect(overlay()?.classList.contains('boosted')).toBe(true);
  }
}, { boostReady: true });

/** Above 100% without a boost graph (the page owns the audio): the label shows, the boost tint does not. */
export const VolumeNoBoostGraph: Story = hudStory(hud => hud.triggerVolumeIndicator(1.25, false, 'up'), {
  play: async () => {
    await expect(hudText()).toBe('200%');
    await expect(overlay()?.classList.contains('boosted')).toBe(false);
  }
});

export const SeekBackward: Story = hudStory(hud => hud.triggerSeekIndicator('left'), {
  play: async () => {
    await expect(queryPlayerUi(`${SEEK}.left`)?.textContent).toBe(t('fiveSeconds'));
  }
}, { progress: SEEK_PHASE_PROGRESS, frames: SEEK_FRAMES });

export const SeekForward: Story = hudStory(hud => hud.triggerSeekIndicator('right'), {
  play: async () => {
    await expect(queryPlayerUi(`${SEEK}.right`)?.textContent).toBe(t('fiveSeconds'));
  }
}, { progress: SEEK_PHASE_PROGRESS, frames: SEEK_FRAMES });

/** Both overlays can show at once: rapid back-and-forth seeking. */
export const SeekBothDirections: Story = hudStory(hud => {
  hud.triggerSeekIndicator('left');
  hud.triggerSeekIndicator('right');
}, {
  play: async () => {
    await expect(getPlayerUiRoot().querySelectorAll(SEEK).length).toBe(2);
    await expect(queryPlayerUi(`${SEEK}.left`)).not.toBeNull();
    await expect(queryPlayerUi(`${SEEK}.right`)).not.toBeNull();
  }
}, { progress: SEEK_PHASE_PROGRESS, frames: SEEK_FRAMES });

export const SeekGerman: Story = {
  ...hudStory(hud => hud.triggerSeekIndicator('right'), {
    play: async () => { await expect(queryPlayerUi(`${SEEK}.right`)?.textContent).toBe('5 Sekunden'); }
  }, { progress: SEEK_PHASE_PROGRESS, frames: SEEK_FRAMES }),
  globals: { locale: 'de' }
};

export const SeekRtlArabic: Story = {
  ...hudStory(hud => hud.triggerSeekIndicator('left'), {
    play: async () => { await expect(queryPlayerUi(`${SEEK}.left`)?.getAttribute('dir')).toBe('rtl'); }
  }, { progress: SEEK_PHASE_PROGRESS, frames: SEEK_FRAMES }),
  globals: { locale: 'ar' }
};

export const Mute: Story = hudStory(hud => hud.triggerStatusIndicator(t('muteHud'), STATUS_HUD_MUTE_ICON), {
  play: async () => { await expect(hudText()).toBe(t('muteHud')); }
});

export const Unmute: Story = hudStory(hud => hud.triggerStatusIndicator(t('unmuteHud'), STATUS_HUD_UNMUTE_ICON), {
  play: async () => { await expect(hudText()).toBe(t('unmuteHud')); }
});

export const VolumeBoostOn: Story = hudStory(hud => hud.triggerStatusIndicator(
  t('volumeBoostHud', t('volumeBoostOn')), VOLUME_BOOST_ICONS.hud
));

export const VideoFit: Story = hudStory(hud => hud.triggerStatusIndicator(videoFitLabel('cover'), STATUS_HUD_FIT_ICON));

export const PictureAlignment: Story = hudStory(hud => hud.triggerStatusIndicator(t('pictureAlignTop'), STATUS_HUD_LAYOUT_ICON));

export const SwitchVideo: Story = hudStory(hud => hud.triggerStatusIndicator(t('cycleIframeHud'), STATUS_HUD_SWITCH_ICON));

export const ControlsPinned: Story = hudStory(hud => hud.triggerStatusIndicator(t('controlsPinnedHud'), CONTROLS_VISIBILITY_ICON));

/** `controls.ts` reports an unavailable action with text only. */
export const NoIcon: Story = hudStory(hud => hud.triggerStatusIndicator(t('nativeChatFullscreenUnavailable'), ''), {
  play: async () => { await expect(overlay()?.querySelector('.volume-hud-icon svg')).toBeNull(); }
});

export const LongLabelGerman: Story = {
  ...hudStory(hud => hud.triggerStatusIndicator(t('onlyOneVideoHud'), STATUS_HUD_SWITCH_ICON), {
    play: async () => { await expect(hudText()).toBe(t('onlyOneVideoHud')); }
  }),
  globals: { locale: 'de' }
};

export const RtlArabic: Story = {
  ...hudStory(hud => hud.triggerStatusIndicator(t('videoFitCover'), STATUS_HUD_FIT_ICON), {
    play: async () => { await expect(overlay()?.getAttribute('dir')).toBe('rtl'); }
  }),
  globals: { locale: 'ar' }
};

function bassStory(bass: AudioSettings['bass']): Story {
  return hudStory(bassHud(bass), {
    play: async () => {
      await expect(overlay()?.dataset.level).toBe(bass);
      await expect(overlay()?.querySelector('.bass-icon')?.getAttribute('data-level')).toBe(bass);
    }
  });
}

export const BassLess: Story = bassStory('less');
export const BassOriginal: Story = bassStory('original');
export const BassMore: Story = bassStory('more');
export const BassMoar: Story = bassStory('moar');
/** The top level: red, with the strongest cabinet shake. */
export const BassMoaaarr: Story = bassStory('moaaarr');

export const BassMoaaarrReducedMotion: Story = {
  ...bassStory('moaaarr'),
  globals: { reduceMotion: 'on' }
};

export const Entering: Story = {
  ...hudStory(hud => hud.triggerVolumeIndicator(0.65, false, 'up')),
  args: { phase: 'entering' }
};

export const Steady: Story = {
  ...hudStory(hud => hud.triggerVolumeIndicator(0.65, false, 'up')),
  args: { phase: 'steady' }
};

export const Leaving: Story = {
  ...hudStory(hud => hud.triggerVolumeIndicator(0.65, false, 'up'), {
    play: async () => { await expect(overlay()?.classList.contains('fade-out')).toBe(true); }
  }),
  args: { phase: 'leaving' }
};

/** On the real clock with animations running, to watch the whole life in Storybook. Not screenshot. */
export const Live: Story = {
  ...hudStory(hud => hud.triggerVolumeIndicator(0.65, false, 'up')),
  tags: ['!frames', 'live'],
  args: { live: true }
};
