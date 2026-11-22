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
import { avatarAccent } from './avatar-accent';
import { createYouTubeSettings } from './youtube/settings';

/** Fictional channels. Avatars are left out: stories run offline, so each author shows its monogram. */
const CHANNELS: ContentAuthor[] = [
  { id: 'harbour', name: 'Harbour Films', url: 'https://www.youtube.com/@harbourfilms', avatarUrl: null, verified: true, stat: '1.26M subscribers' },
  { id: 'bottle', name: 'Bottlewright', url: 'https://www.youtube.com/@bottlewright', avatarUrl: null, verified: false, stat: '6.1K subscribers' },
  { id: 'tide', name: 'Tide Pool Club', url: 'https://www.youtube.com/@tidepoolclub', avatarUrl: null, verified: false, stat: null }
];
/**
 * Stand-ins for avatars, as the pixels the panel reads: a disc of the mark's color on a ground, at the 24×24 the
 * avatar is read at. They go through the production extraction; the image itself cannot load offline, so the
 * monogram stands in for the picture.
 */
const AVATARS = {
  blue: ['#1e88e5', '#ffffff'],
  orange: ['#ff7a00', '#1b1b1b'],
  // Too dark for the plate: lifted into the accent range with its hue kept.
  navy: ['#0b1f4b', '#f2f2f2'],
  // Too pale: deepened the same way.
  pastel: ['#f7c6d9', '#ffffff'],
  // No color to take: the plate keeps the user's accent.
  gray: ['#8a8a8a', '#e6e6e6']
} as const;
type Avatar = keyof typeof AVATARS | 'none';

function avatarPixels([mark, ground]: readonly [string, string]): Uint8ClampedArray {
  const rgb = (hex: string) => hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16));
  const pixels = new Uint8ClampedArray(24 * 24 * 4);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
    const inside = (x - 11.5) ** 2 + (y - 11.5) ** 2 < 8 ** 2;
    pixels.set([...rgb(inside ? mark : ground), 255], (y * 24 + x) * 4);
  }
  return pixels;
}
const avatarUrl = (avatar: keyof typeof AVATARS) => `https://yt3.ggpht.com/story-${avatar}=s88`;
/** Every read the stories' panels made, so `play` can wait for the one that leaves the user's accent. */
const reads: Array<Promise<string | null>> = [];
const readAccent = (url: string) => {
  const avatar = (Object.keys(AVATARS) as Array<keyof typeof AVATARS>).find(name => avatarUrl(name) === url);
  const read = Promise.resolve(avatar ? avatarAccent(avatarPixels(AVATARS[avatar])) : null);
  reads.push(read);
  return read;
};

const HOSTS = providerAuthorHosts([{ domain: 'youtube.com', includeSubdomains: true }], ['yt3.ggpht.com']);
const TITLE = 'Building a cedar-strip canoe, part 3: fibreglass';
const LONG_TITLE = 'Building a cedar-strip canoe, part 3: fibreglass, epoxy, the first coat of varnish and every mistake left in';

interface Args extends HudArgs { authors: number; accent: AccentColorPreset; avatar: Avatar; title: string; open: 'closed' | 'click' | 'keyboard' }
const meta: Meta<Args> = {
  title: 'Components/Author byline',
  args: { phase: 'steady', live: false, authors: 1, accent: 'red', avatar: 'none', title: TITLE, open: 'closed' },
  argTypes: {
    authors: { control: { type: 'range', min: 0, max: 3 } },
    accent: { control: 'select', options: ['red', 'purple', 'pink', 'yellow', 'blue', 'green', 'gray'] },
    avatar: { control: 'select', options: ['none', ...Object.keys(AVATARS)] },
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
    const control = mountAuthorByline({ scope, bindMenu: bindMenuPopover }, { provider: 'youtube', hosts: HOSTS, settings, readAccent });
    const authors = CHANNELS.slice(0, values.authors);
    if (authors.length && values.avatar !== 'none') authors[0] = { ...authors[0], avatarUrl: avatarUrl(values.avatar) };
    hud.syncContentTitle({ title: values.title, subtitle: null, authors }, control);
    const plate = queryPlayerUi<HTMLElement>(`.${TITLE_HUD_CLASS}`);
    if (plate) applyAccentColorPreset(plate, values.accent);
  }, {
    args,
    play: async ({ args: values }) => {
      // The panel waits for the provider setting to load from storage.
      if (!values.authors) { await expect(panel()).toBeNull(); return; }
      await waitFor(() => expect(panel()).not.toBeNull());
      // The avatar's color arrives when the page is idle; a gray avatar leaves the user's accent.
      const accent = () => panel()!.style.getPropertyValue('--accent-color');
      if (values.avatar === 'gray') {
        await waitFor(() => expect(reads.length).toBeGreaterThan(0));
        await Promise.all(reads);
        await expect(accent()).toBe('');
      } else if (values.avatar !== 'none') await waitFor(() => expect(accent()).toMatch(/^#[0-9a-f]{6}$/));
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
// One block of rows that alternate from the second author; each row is its channel's link.
export const ThreeAuthorsOpen = byline({ authors: 3, accent: 'green', open: 'click' });
// The first row takes focus and shows its ring inside the block.
export const KeyboardOpen = byline({ authors: 2, open: 'keyboard', accent: 'blue' });
export const YellowAccentOpen = byline({ accent: 'yellow', open: 'click' });
export const LongTitle = byline({ title: LONG_TITLE, authors: 2 });
export const NoAuthor = byline({ authors: 0 });
// The first author's avatar colors the panel, open here so its fill shows; the popup keeps the user's accent.
export const AvatarBlueOpen = byline({ avatar: 'blue', open: 'click' });
export const AvatarOrange = byline({ avatar: 'orange', authors: 2 });
export const AvatarNavyOpen = byline({ avatar: 'navy', authors: 2, open: 'click' });
export const AvatarPastelOpen = byline({ avatar: 'pastel', open: 'click' });
export const AvatarGrayFallbackOpen = byline({ avatar: 'gray', accent: 'purple', open: 'click' });
