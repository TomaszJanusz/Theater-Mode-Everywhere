import { expect, test } from 'vitest';

import type { AudioSettings } from '../../src/audio-settings';
import { videoFitLabel } from '../../src/ui/appearance';
import { CONTROLS_VISIBILITY_ICON } from '../../src/ui/controls-visibility';
import {
  STATUS_HUD_FIT_ICON, STATUS_HUD_LAYOUT_ICON, STATUS_HUD_MUTE_ICON, STATUS_HUD_SWITCH_ICON,
  STATUS_HUD_UNMUTE_ICON, VOLUME_BOOST_ICONS
} from '../../src/ui/hud';
import { t } from '../../src/ui/messages';
import { getPlayerUiRoot, queryPlayerUi } from '../../src/ui/root';
import { hudCase as hudStory, runHudCase, type HudCase } from '../fixture-test';
import {
  bassHud, hudText, overlay, SEEK, SEEK_FRAMES, SEEK_PHASE_PROGRESS
} from '../hud-story';


type Story = HudCase;

const Play: Story = hudStory(hud => hud.triggerPlaybackIndicator('play'), {
  play: async () => {
    await expect(hudText()).toBe(t('play'));
    await expect(overlay()?.dataset.playbackAction).toBe('play');
  }
});
test('Play', () => runHudCase(Play));

const Pause: Story = hudStory(hud => hud.triggerPlaybackIndicator('pause'), {
  play: async () => {
    await expect(hudText()).toBe(t('pause'));
  }
});
test('Pause', () => runHudCase(Pause));

const VolumeUp: Story = hudStory(hud => hud.triggerVolumeIndicator(0.65, false, 'up'), {
  play: async () => {
    await expect(hudText()).toBe('65%');
    await expect(overlay()?.querySelector('.volume-hud-text')?.classList.contains('zoom-in')).toBe(true);
  }
});
test('VolumeUp', () => runHudCase(VolumeUp));

const VolumeDown: Story = hudStory(hud => hud.triggerVolumeIndicator(0.3, false, 'down'), {
  play: async () => {
    await expect(hudText()).toBe('30%');
    await expect(overlay()?.querySelector('.volume-hud-text')?.classList.contains('zoom-out')).toBe(true);
  }
});
test('VolumeDown', () => runHudCase(VolumeDown));

const VolumeFull: Story = hudStory(hud => hud.triggerVolumeIndicator(1, false, 'up'), {
  play: async () => { await expect(hudText()).toBe('100%'); }
});
test('VolumeFull', () => runHudCase(VolumeFull));

const VolumeZero: Story = hudStory(hud => hud.triggerVolumeIndicator(0, false, 'down'), {
  play: async () => { await expect(hudText()).toBe('0%'); }
});
test('VolumeZero', () => runHudCase(VolumeZero));

const VolumeMuted: Story = hudStory(hud => hud.triggerVolumeIndicator(0.8, true, 'down'), {
  play: async () => { await expect(hudText()).toBe('0%'); }
});
test('VolumeMuted', () => runHudCase(VolumeMuted));

const VolumeBoosted: Story = hudStory(hud => hud.triggerVolumeIndicator(1.25, false, 'up'), {
  play: async () => {
    await expect(hudText()).toBe('200%');
    await expect(overlay()?.classList.contains('boosted')).toBe(true);
  }
}, { boostReady: true });
test('VolumeBoosted', () => runHudCase(VolumeBoosted));

/** Above 100% without a boost graph (the page owns the audio): the label shows, the boost tint does not. */
const VolumeNoBoostGraph: Story = hudStory(hud => hud.triggerVolumeIndicator(1.25, false, 'up'), {
  play: async () => {
    await expect(hudText()).toBe('200%');
    await expect(overlay()?.classList.contains('boosted')).toBe(false);
  }
});
test('VolumeNoBoostGraph', () => runHudCase(VolumeNoBoostGraph));

const SeekBackward: Story = hudStory(hud => hud.triggerSeekIndicator('left'), {
  play: async () => {
    await expect(queryPlayerUi(`${SEEK}.left`)?.textContent).toBe(t('fiveSeconds'));
  }
}, { progress: SEEK_PHASE_PROGRESS, frames: SEEK_FRAMES });
test('SeekBackward', () => runHudCase(SeekBackward));

const SeekForward: Story = hudStory(hud => hud.triggerSeekIndicator('right'), {
  play: async () => {
    await expect(queryPlayerUi(`${SEEK}.right`)?.textContent).toBe(t('fiveSeconds'));
  }
}, { progress: SEEK_PHASE_PROGRESS, frames: SEEK_FRAMES });
test('SeekForward', () => runHudCase(SeekForward));

/** Both overlays can show at once: rapid back-and-forth seeking. */
const SeekBothDirections: Story = hudStory(hud => {
  hud.triggerSeekIndicator('left');
  hud.triggerSeekIndicator('right');
}, {
  play: async () => {
    await expect(getPlayerUiRoot().querySelectorAll(SEEK).length).toBe(2);
    await expect(queryPlayerUi(`${SEEK}.left`)).not.toBeNull();
    await expect(queryPlayerUi(`${SEEK}.right`)).not.toBeNull();
  }
}, { progress: SEEK_PHASE_PROGRESS, frames: SEEK_FRAMES });
test('SeekBothDirections', () => runHudCase(SeekBothDirections));

const SeekGerman: Story = {
  ...hudStory(hud => hud.triggerSeekIndicator('right'), {
    play: async () => { await expect(queryPlayerUi(`${SEEK}.right`)?.textContent).toBe('5 Sekunden'); }
  }, { progress: SEEK_PHASE_PROGRESS, frames: SEEK_FRAMES }),
  globals: { locale: 'de' }
};
test('SeekGerman', () => runHudCase(SeekGerman));

const SeekRtlArabic: Story = {
  ...hudStory(hud => hud.triggerSeekIndicator('left'), {
    play: async () => { await expect(queryPlayerUi(`${SEEK}.left`)?.getAttribute('dir')).toBe('rtl'); }
  }, { progress: SEEK_PHASE_PROGRESS, frames: SEEK_FRAMES }),
  globals: { locale: 'ar' }
};
test('SeekRtlArabic', () => runHudCase(SeekRtlArabic));

const Mute: Story = hudStory(hud => hud.triggerStatusIndicator(t('muteHud'), STATUS_HUD_MUTE_ICON), {
  play: async () => { await expect(hudText()).toBe(t('muteHud')); }
});
test('Mute', () => runHudCase(Mute));

const Unmute: Story = hudStory(hud => hud.triggerStatusIndicator(t('unmuteHud'), STATUS_HUD_UNMUTE_ICON), {
  play: async () => { await expect(hudText()).toBe(t('unmuteHud')); }
});
test('Unmute', () => runHudCase(Unmute));

const VolumeBoostOn: Story = hudStory(hud => hud.triggerStatusIndicator(
  t('volumeBoostHud', t('volumeBoostOn')), VOLUME_BOOST_ICONS.hud
));
test('VolumeBoostOn', () => runHudCase(VolumeBoostOn));

const VideoFit: Story = hudStory(hud => hud.triggerStatusIndicator(videoFitLabel('cover'), STATUS_HUD_FIT_ICON));
test('VideoFit', () => runHudCase(VideoFit));

const PictureAlignment: Story = hudStory(hud => hud.triggerStatusIndicator(t('pictureAlignTop'), STATUS_HUD_LAYOUT_ICON));
test('PictureAlignment', () => runHudCase(PictureAlignment));

const SwitchVideo: Story = hudStory(hud => hud.triggerStatusIndicator(t('cycleIframeHud'), STATUS_HUD_SWITCH_ICON));
test('SwitchVideo', () => runHudCase(SwitchVideo));

const ControlsPinned: Story = hudStory(hud => hud.triggerStatusIndicator(t('controlsPinnedHud'), CONTROLS_VISIBILITY_ICON));
test('ControlsPinned', () => runHudCase(ControlsPinned));

/** `controls.ts` reports an unavailable action with text only. */
const NoIcon: Story = hudStory(hud => hud.triggerStatusIndicator(t('nativeChatFullscreenUnavailable'), ''), {
  play: async () => { await expect(overlay()?.querySelector('.volume-hud-icon svg')).toBeNull(); }
});
test('NoIcon', () => runHudCase(NoIcon));

const LongLabelGerman: Story = {
  ...hudStory(hud => hud.triggerStatusIndicator(t('onlyOneVideoHud'), STATUS_HUD_SWITCH_ICON), {
    play: async () => { await expect(hudText()).toBe(t('onlyOneVideoHud')); }
  }),
  globals: { locale: 'de' }
};
test('LongLabelGerman', () => runHudCase(LongLabelGerman));

const RtlArabic: Story = {
  ...hudStory(hud => hud.triggerStatusIndicator(t('videoFitCover'), STATUS_HUD_FIT_ICON), {
    play: async () => { await expect(overlay()?.getAttribute('dir')).toBe('rtl'); }
  }),
  globals: { locale: 'ar' }
};
test('RtlArabic', () => runHudCase(RtlArabic));

function bassStory(bass: AudioSettings['bass']): Story {
  return hudStory(bassHud(bass), {
    play: async () => {
      await expect(overlay()?.dataset.level).toBe(bass);
      await expect(overlay()?.querySelector('.bass-icon')?.getAttribute('data-level')).toBe(bass);
    }
  });
}

const BassLess: Story = bassStory('less');
test('BassLess', () => runHudCase(BassLess));
const BassOriginal: Story = bassStory('original');
test('BassOriginal', () => runHudCase(BassOriginal));
const BassMore: Story = bassStory('more');
test('BassMore', () => runHudCase(BassMore));
const BassMoar: Story = bassStory('moar');
test('BassMoar', () => runHudCase(BassMoar));
/** The top level: red, with the strongest cabinet shake. */
const BassMoaaarr: Story = bassStory('moaaarr');
test('BassMoaaarr', () => runHudCase(BassMoaaarr));

const BassMoaaarrReducedMotion: Story = {
  ...bassStory('moaaarr'),
  globals: { reduceMotion: 'on' }
};
test('BassMoaaarrReducedMotion', () => runHudCase(BassMoaaarrReducedMotion));

const Entering: Story = {
  ...hudStory(hud => hud.triggerVolumeIndicator(0.65, false, 'up')),
  args: { phase: 'entering' }
};
test('Entering', () => runHudCase(Entering));

const Steady: Story = {
  ...hudStory(hud => hud.triggerVolumeIndicator(0.65, false, 'up')),
  args: { phase: 'steady' }
};
test('Steady', () => runHudCase(Steady));

const Leaving: Story = {
  ...hudStory(hud => hud.triggerVolumeIndicator(0.65, false, 'up'), {
    play: async () => { await expect(overlay()?.classList.contains('fade-out')).toBe(true); }
  }),
  args: { phase: 'leaving' }
};
test('Leaving', () => runHudCase(Leaving));

/** On the real clock with animations running, to watch the whole life in Storybook. Not screenshot. */
const Live: Story = {
  ...hudStory(hud => hud.triggerVolumeIndicator(0.65, false, 'up')),
  tags: ['!frames', 'live'],
  args: { live: true }
};
test('Live', () => runHudCase(Live));
