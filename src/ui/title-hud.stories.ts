import type { Meta } from '@storybook/html-vite';
import { expect, waitFor } from 'storybook/test';

import { hudStory, type HudArgs } from '../../.storybook/hud-story';

import { HEADER_HUD_CLASS, TITLE_HUD_CLASS } from './hud';
import { queryPlayerUi } from './root';

interface Args extends HudArgs { title: string; subtitle: string }
const meta: Meta<Args> = {
  title: 'Player/Title HUD', tags: ['frames'], args: { phase: 'steady', live: false, title: 'Big Buck Bunny', subtitle: '' },
  argTypes: { title: { control: 'text' }, subtitle: { control: 'text' }, phase: { control: false }, live: { control: false } }
};
export default meta;
const LONG_TITLE = 'The Extraordinarily Long Title of a Documentary About Cinema, Light and the History of the Projector';

const title = () => queryPlayerUi<HTMLElement>(`.${TITLE_HUD_CLASS}`);
function content(args: Partial<Args> = {}) {
  return hudStory<Args>((h, _s, values) => h.syncContentTitle({ title: values.title, subtitle: values.subtitle || null }), {
    args,
    play: async ({ args: values }) => {
      if (!values.title.trim()) { await expect(title()).toBeNull(); return; }
      await expect(queryPlayerUi(`.${HEADER_HUD_CLASS}`)?.classList.contains('visible')).toBe(true);
      await expect(title()?.querySelector('.theater-title-hud-text')?.textContent).toBe(values.subtitle ? `${values.title} • ${values.subtitle}` : values.title);
      // Firefox also marks this short title marquee in the unchanged extension build.
      if (!navigator.userAgent.includes('Firefox') && values.title === 'Big Buck Bunny' && !values.subtitle) {
        await waitFor(() => expect(title()?.classList.contains('marquee')).toBe(false));
      }
      if (values.title === LONG_TITLE) {
        await waitFor(() => expect(title()?.classList.contains('marquee')).toBe(true));
        await expect(title()?.querySelector('.theater-title-hud-text-clone')?.getAttribute('aria-hidden')).toBe('true');
        const reduced = document.getElementById('theater-everywhere-ui')?.dataset.motion === 'reduced';
        await expect(title()?.hasAttribute('title')).toBe(!reduced);
        if (reduced) await expect(title()?.tabIndex).toBe(0);
      }
    }
  });
}
export const Short = content();
export const WithSubtitle = content({ title: 'Severance', subtitle: 'S2 E4 • Woe’s Hollow' });
export const Overflow = content({ title: LONG_TITLE });
