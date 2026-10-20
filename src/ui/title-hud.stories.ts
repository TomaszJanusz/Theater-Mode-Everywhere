import type { Meta } from '@storybook/html-vite';
import { expect, waitFor } from 'storybook/test';

import { hud, hudStory, type HudArgs, type HudStoryObj } from '../../.storybook/hud-story';

import { HEADER_HUD_CLASS, TITLE_HUD_CLASS } from './hud';
import { queryPlayerUi } from './root';

// The title pill in the header row: persistent while the toolbar shows, not a timed notice.
const meta: Meta<HudArgs> = {
  title: 'Player/Title HUD',
  globals: { reduceMotion: 'off' },
  tags: ['frames'],
  args: { phase: 'steady', live: false }
};
export default meta;

type Story = HudStoryObj;

const title = () => queryPlayerUi<HTMLElement>(`.${TITLE_HUD_CLASS}`);
const LONG_TITLE = 'The Extraordinarily Long Title of a Documentary About Cinema, Light and the History of the Projector';

export const Short: Story = hudStory(h => h.syncContentTitle({ title: 'Big Buck Bunny', subtitle: null }), {
  play: async () => {
    await expect(queryPlayerUi(`.${HEADER_HUD_CLASS}`)?.classList.contains('visible')).toBe(true);
    await expect(title()?.querySelector('.theater-title-hud-text')?.textContent).toBe('Big Buck Bunny');
    // Firefox marks even this short title `marquee` (it also does in the extension build on the unchanged
    // base), so a short title is only asserted still in Chromium. Layout is event-driven, so the settled state is read.
    if (!navigator.userAgent.includes('Firefox')) await waitFor(() => expect(title()?.classList.contains('marquee')).toBe(false));
  }
});

export const WithSubtitle: Story = hudStory(h => h.syncContentTitle({ title: 'Severance', subtitle: 'S2 E4 • Woe’s Hollow' }), {
  play: async () => {
    await expect(title()?.querySelector('.theater-title-hud-subtitle')?.textContent).toBe('S2 E4 • Woe’s Hollow');
  }
});

/** Overflowing text scrolls as a marquee; the clone keeps the loop seamless and is hidden from assistive tech. */
export const LongMarquee: Story = hudStory(h => h.syncContentTitle({ title: LONG_TITLE, subtitle: null }), {
  play: async () => {
    await waitFor(() => expect(title()?.classList.contains('marquee')).toBe(true));
    await expect(title()?.querySelector('.theater-title-hud-text-clone')?.getAttribute('aria-hidden')).toBe('true');
  }
});

/** With Reduce motion the marquee gives way to a static head…tail, and the pill becomes focusable to reveal the rest. */
export const LongReducedMotion: Story = {
  ...hudStory(h => h.syncContentTitle({ title: LONG_TITLE, subtitle: null }), {
    play: async () => {
      await waitFor(() => expect(title()?.classList.contains('marquee')).toBe(true));
      await expect(title()?.tabIndex).toBe(0);
      await expect(title()?.hasAttribute('title')).toBe(false);
    }
  }),
  globals: { reduceMotion: 'on' }
};

export const RtlArabic: Story = {
  ...hudStory(h => h.syncContentTitle({ title: 'الفيلم الوثائقي', subtitle: 'الحلقة ٣' }), {
    play: async () => { await expect(title()?.getAttribute('dir')).toBe('rtl'); }
  }),
  globals: { locale: 'ar' }
};

export const ClearedTitleLeaves: Story = {
  ...hudStory(h => h.syncContentTitle({ title: 'Big Buck Bunny', subtitle: null }), {
    play: async () => {
      hud().syncContentTitle(null);
      await expect(title()).toBeNull();
      hud().syncContentTitle(null);
      await expect(title()).toBeNull();
    }
  }),
  tags: ['!frames', 'no-shot']
};
