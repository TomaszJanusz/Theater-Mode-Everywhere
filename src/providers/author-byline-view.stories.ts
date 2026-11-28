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

/**
 * `click` and `keyboard` (Enter) open a button arrow, whose first author has no link; a link arrow is opened by
 * `hover` or `arrow` (↓ on the focused arrow), since its click and Enter follow the link.
 */
type Opening = 'closed' | 'click' | 'keyboard' | 'arrow' | 'focus' | 'hover' | 'home';
interface Args extends HudArgs {
  authors: number; accent: AccentColorPreset;
  /** Each author's avatar, in order; authors past the list have none. */
  avatars: Avatar[];
  /** Whether the first author's channel link is admitted. */
  linked: boolean;
  title: string; open: Opening;
}
const meta: Meta<Args> = {
  title: 'Components/Author byline',
  args: { phase: 'steady', live: false, authors: 1, accent: 'red', avatars: [], linked: true, title: TITLE, open: 'closed' },
  argTypes: {
    authors: { control: { type: 'range', min: 0, max: 3 } },
    accent: { control: 'select', options: ['red', 'purple', 'pink', 'yellow', 'blue', 'green', 'gray'] },
    avatars: { control: 'object' },
    open: { control: 'inline-radio', options: ['closed', 'click', 'keyboard', 'arrow', 'focus', 'hover', 'home'] },
    title: { control: 'text' }, phase: { control: false }, live: { control: false }
  }
};
export default meta;

const panel = () => queryPlayerUi<HTMLElement>(`.${TITLE_HUD_CLASS} .theater-byline-panel`);
const rows = () => [...queryPlayerUi<HTMLElement>(`.${TITLE_HUD_CLASS} .theater-byline-list`)?.children ?? []]
  .map(item => item.firstElementChild as HTMLElement);
const popupShown = () => {
  const popup = queryPlayerUi<HTMLElement>(`.${TITLE_HUD_CLASS} .theater-byline-popup`);
  return popup !== null && getComputedStyle(popup).visibility === 'visible';
};
/** The color an avatar stand-in gives, through the production extraction; null keeps the user's accent. */
const expectedAccent = (avatar: Avatar | undefined) => (avatar && avatar !== 'none' ? avatarAccent(avatarPixels(AVATARS[avatar])) : null) ?? '';

/** The panel's element and, for one author, the popup it does not have. */
async function expectShape(values: Args): Promise<void> {
  const tag = values.authors > 1 ? 'BUTTON' : 'DIV';
  await expect(panel()!.tagName).toBe(values.linked ? 'A' : tag);
  if (values.authors > 1) return;
  await expect(panel()!.hasAttribute('aria-expanded')).toBe(false);
  await expect(queryPlayerUi(`.${TITLE_HUD_CLASS} .theater-byline-popup`)).toBeNull();
}

const accentOf = (node: HTMLElement) => node.style.getPropertyValue('--accent-color');

/** The first avatar's color arrives when the page is idle; a gray avatar leaves the user's accent. */
async function awaitPanelAccent(first: Avatar | undefined): Promise<void> {
  if (first === 'gray') {
    await waitFor(() => expect(reads.length).toBeGreaterThan(0));
    await Promise.all(reads);
    await expect(accentOf(panel()!)).toBe('');
  } else if (first && first !== 'none') await waitFor(() => expect(accentOf(panel()!)).toBe(expectedAccent(first)));
}

/** Opens or points at the panel as the story asks; false when nothing is left to check. */
async function interact(values: Args): Promise<boolean> {
  // The home button's hover takes the arrow's avatar color, or keeps the user's accent without one.
  if (values.open === 'home') {
    const home = queryPlayerUi<HTMLElement>('.theater-home-pill')!;
    await userEvent.hover(home);
    await waitFor(() => expect(home.style.getPropertyValue('--accent-color')).toBe(expectedAccent(values.avatars[0])));
    return false;
  }
  if (values.open === 'click') await userEvent.click(panel()!);
  if (values.open === 'keyboard' || values.open === 'arrow') {
    panel()!.focus();
    await userEvent.keyboard(values.open === 'arrow' ? '{ArrowDown}' : '{Enter}');
  }
  // Focus alone lifts the panel without opening anything.
  if (values.open === 'focus') {
    panel()!.focus();
    await expect(panel()!.matches(':focus-visible')).toBe(true);
    if (values.authors > 1) await expect(panel()!.getAttribute('aria-expanded')).toBe('false');
    return false;
  }
  if (values.open === 'hover') {
    await userEvent.hover(panel()!);
    // The pointer on the panel or its popup leaves the scrolling title running and without a tooltip.
    const track = queryPlayerUi<HTMLElement>(`.${TITLE_HUD_CLASS} .theater-title-hud-track`)!;
    if (queryPlayerUi(`.${TITLE_HUD_CLASS}.marquee`)) {
      await expect(getComputedStyle(track).animationPlayState).toBe('running');
      await expect(panel()!.closest('[title]')!.getAttribute('title')).toBe('');
    }
  }
  return values.open !== 'closed' && values.authors > 1;
}

function byline(args: Partial<Args> = {}) {
  return hudStory<Args>((hud, stage, values) => {
    const scope = new DisposableScope();
    stage.onDispose(() => scope.dispose());
    const settings = createYouTubeSettings();
    const control = mountAuthorByline({ scope, bindMenu: bindMenuPopover }, { provider: 'youtube', hosts: HOSTS, settings, readAccent });
    const authors = CHANNELS.slice(0, values.authors).map((channel, index) => {
      const avatar = values.avatars[index];
      return { ...channel, url: index === 0 && !values.linked ? null : channel.url, avatarUrl: avatar && avatar !== 'none' ? avatarUrl(avatar) : null };
    });
    hud.syncContentTitle({ title: values.title, subtitle: null, authors }, control);
    const plate = queryPlayerUi<HTMLElement>(`.${TITLE_HUD_CLASS}`);
    if (plate) applyAccentColorPreset(plate, values.accent);
    // A link activated here would open a tab: the stories only show the panel.
    plate?.addEventListener('click', event => { if ((event.target as Element).closest('a')) event.preventDefault(); }, { capture: true, signal: scope.signal });
  }, {
    args,
    play: async ({ args: values }) => {
      // The panel waits for the provider setting to load from storage.
      if (!values.authors) { await expect(panel()).toBeNull(); return; }
      await waitFor(() => expect(panel()).not.toBeNull());
      await expectShape(values);
      await awaitPanelAccent(values.avatars[0]);
      if (!await interact(values)) return;
      await expect(panel()!.getAttribute('aria-expanded')).toBe('true');
      await waitFor(() => expect(popupShown()).toBe(true));
      // Every author has a row, the first too, each in its own avatar's color once the popup has opened.
      await expect(rows()).toHaveLength(values.authors);
      await waitFor(() => expect(rows().map(accentOf)).toEqual(CHANNELS.slice(0, values.authors).map((_, index) => expectedAccent(values.avatars[index]))));
    }
  });
}

// One author: the whole panel is their channel link, with no popup. The accent ramp shows at rest; hover and focus
// lift the panel and step the arrowhead forward.
export const OneAuthor = byline();
export const OneAuthorFocused = byline({ open: 'focus' });
export const OneAuthorHovered = byline({ open: 'hover' });
// One author without a link the host admits: a plain panel that does not lift.
export const OneAuthorUnlinked = byline({ linked: false, open: 'hover' });
// Also shot in German and Arabic (right-to-left): see .storybook/profiles.ts.
export const TwoAuthorsOpen = byline({ authors: 2, accent: 'purple', avatars: ['blue', 'orange'], open: 'arrow' });
// Hover lists every author, the one the arrow stands for too.
export const TwoAuthorsHoverOpen = byline({ authors: 2, accent: 'purple', avatars: ['orange', 'blue'], open: 'hover' });
export const ThreeAuthors = byline({ authors: 3, accent: 'pink' });
// One block of rows that alternate from the second author; each row is its channel's link, in its avatar's color.
export const ThreeAuthorsOpen = byline({ authors: 3, accent: 'green', avatars: ['blue', 'orange', 'pastel'], open: 'arrow' });
// The first row takes focus and shows its ring inside the block.
export const KeyboardOpen = byline({ authors: 2, open: 'arrow', accent: 'blue' });
// A first author without a link: the arrow is the popup's button, which a click opens.
export const ButtonArrowOpen = byline({ authors: 2, linked: false, avatars: ['navy', 'orange'], open: 'click' });
export const ButtonArrowKeyboardOpen = byline({ authors: 3, linked: false, accent: 'yellow', open: 'keyboard' });
export const YellowAccentOpen = byline({ authors: 2, accent: 'yellow', open: 'arrow' });
export const LongTitle = byline({ title: LONG_TITLE, authors: 2 });
// The pointer on the panel opens its popup and leaves the scrolling title running, without the title's tooltip.
export const LongTitleOverPanel = byline({ title: LONG_TITLE, authors: 2, open: 'hover' });
export const NoAuthor = byline({ authors: 0 });
// The first author's avatar colors the panel; open, each row takes its own avatar's color.
export const AvatarBlue = byline({ avatars: ['blue'] });
export const AvatarOrange = byline({ avatars: ['orange'], authors: 2 });
export const AvatarNavyOpen = byline({ avatars: ['navy', 'pastel'], authors: 2, open: 'arrow' });
export const AvatarPastelHovered = byline({ avatars: ['pastel'], open: 'hover' });
// The home button's hover takes the arrow's avatar color; a gray avatar leaves it the user's accent.
export const HomeHoverAvatarColor = byline({ avatars: ['orange'], accent: 'purple', open: 'home' });
export const HomeHoverFallback = byline({ avatars: ['gray'], accent: 'purple', open: 'home' });
// A gray avatar keeps the user's accent, on the panel and on its row.
export const AvatarGrayFallbackOpen = byline({ avatars: ['gray', 'blue', 'none'], authors: 3, accent: 'purple', open: 'arrow' });
