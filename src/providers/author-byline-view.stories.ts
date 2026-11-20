import type { Meta } from '@storybook/html-vite';
import { expect, userEvent, waitFor } from 'storybook/test';

import { hudStory, type HudArgs } from '../../.storybook/hud-story';
import { applyAccentColorPreset, type AccentColorPreset } from '../accentTheme';
import { DisposableScope } from '../core/disposable-scope';
import type { ContentAuthor } from '../media-features/content-title';
import { TITLE_HUD_CLASS } from '../ui/hud';
import { bindMenuPopover } from '../ui/menu-popover';
import { queryPlayerUi } from '../ui/root';

import { providerAuthorHosts } from './author-byline';
import { mountAuthorByline } from './author-byline-view';
import { createYouTubeSettings } from './youtube/settings';

/** Fictional channels. Avatars are left out: stories run offline, so each author shows its monogram. */
const CHANNELS: ContentAuthor[] = [
  { id: 'harbour', name: 'Harbour Films', url: 'https://www.youtube.com/@harbourfilms', avatarUrl: null, verified: true, stat: '1.26M subscribers' },
  { id: 'bottle', name: 'Bottlewright', url: 'https://www.youtube.com/@bottlewright', avatarUrl: null, verified: false, stat: '6.1K subscribers' },
  { id: 'tide', name: 'Tide Pool Club', url: 'https://www.youtube.com/@tidepoolclub', avatarUrl: null, verified: false, stat: null }
];
const HOSTS = providerAuthorHosts([{ domain: 'youtube.com', includeSubdomains: true }], ['yt3.ggpht.com']);
const TITLE = 'Building a cedar-strip canoe, part 3: fibreglass';
const LONG_TITLE = 'Building a cedar-strip canoe, part 3: fibreglass, epoxy, the first coat of varnish and every mistake left in';

interface Args extends HudArgs { authors: number; accent: AccentColorPreset; title: string; open: 'closed' | 'click' | 'keyboard' }
const meta: Meta<Args> = {
  title: 'Components/Author byline',
  args: { phase: 'steady', live: false, authors: 1, accent: 'red', title: TITLE, open: 'closed' },
  argTypes: {
    authors: { control: { type: 'range', min: 0, max: 3 } },
    accent: { control: 'select', options: ['red', 'purple', 'pink', 'yellow', 'blue', 'green', 'gray'] },
    open: { control: 'inline-radio', options: ['closed', 'click', 'keyboard'] },
    title: { control: 'text' }, phase: { control: false }, live: { control: false }
  }
};
export default meta;

const panel = () => queryPlayerUi<HTMLButtonElement>(`.${TITLE_HUD_CLASS} .theater-byline-panel`);

function byline(args: Partial<Args> = {}) {
  return hudStory<Args>((hud, stage, values) => {
    const scope = new DisposableScope();
    stage.onDispose(() => scope.dispose());
    const settings = createYouTubeSettings();
    const control = mountAuthorByline({ scope, bindMenu: bindMenuPopover }, { provider: 'youtube', hosts: HOSTS, settings });
    hud.syncContentTitle({ title: values.title, subtitle: null, authors: CHANNELS.slice(0, values.authors) }, control);
    const plate = queryPlayerUi<HTMLElement>(`.${TITLE_HUD_CLASS}`);
    if (plate) applyAccentColorPreset(plate, values.accent);
  }, {
    args,
    play: async ({ args: values }) => {
      // The panel waits for the provider setting to load from storage.
      if (!values.authors) { await expect(panel()).toBeNull(); return; }
      await waitFor(() => expect(panel()).not.toBeNull());
      if (values.open === 'click') await userEvent.click(panel()!);
      if (values.open === 'keyboard') {
        panel()!.focus();
        await userEvent.keyboard('{Enter}');
      }
      if (values.open !== 'closed') await expect(panel()!.getAttribute('aria-expanded')).toBe('true');
    }
  });
}

export const OneAuthor = byline();
export const OneAuthorOpen = byline({ open: 'click' });
// Also shot in German and Arabic (right-to-left): see .storybook/profiles.ts.
export const TwoAuthorsOpen = byline({ authors: 2, accent: 'purple', open: 'click' });
export const ThreeAuthors = byline({ authors: 3, accent: 'pink' });
export const KeyboardOpen = byline({ authors: 2, open: 'keyboard', accent: 'blue' });
export const YellowAccentOpen = byline({ accent: 'yellow', open: 'click' });
export const LongTitle = byline({ title: LONG_TITLE, authors: 2 });
export const NoAuthor = byline({ authors: 0 });
