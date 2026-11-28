import { expect } from 'vitest';
import { userEvent } from 'vitest/browser';

import { mountHudStage } from '../../.storybook/hud-stage';
import { DisposableScope } from '../core/disposable-scope';
import type { ContentAuthor } from '../media-features/content-title';
import { providerAuthorHosts } from '../providers/author-byline';
import { watchAuthorBylineSetting } from '../providers/author-byline-setting';
import { mountAuthorByline } from '../providers/author-byline-view';
import { BYLINE_STORAGE_KEY } from '../providers/settings-values';
import { createYouTubeSettings } from '../providers/youtube/settings';
import { createHud, TITLE_HUD_CLASS } from '../ui/hud';
import { bindMenuPopover } from '../ui/menu-popover';
import { getPlayerUiRoot, queryPlayerUi } from '../ui/root';

// The author byline in a real title plate, for its component tests: YouTube's hosts and settings, the global switch
// read from the storage the Settings page writes, and avatar reads the test controls.

const HOSTS = providerAuthorHosts([{ domain: 'youtube.com', includeSubdomains: true }], ['yt3.ggpht.com']);
export const AVATAR = 'https://yt3.ggpht.com/avatar=s88';
export const author = (name: string, overrides: Partial<ContentAuthor> = {}): ContentAuthor => ({
  id: name, name, url: `https://www.youtube.com/@${name.replace(/\W/g, '')}`, avatarUrl: null, verified: false, stat: null, ...overrides
});
/** A channel without a link the provider admits. */
export const unlinked = (name: string, overrides: Partial<ContentAuthor> = {}) => author(name, { url: null, ...overrides });

export type ReadAccent = (avatarUrl: string, signal: AbortSignal) => Promise<string | null>;
/** Idle callbacks run in order, so this resolves after any the view scheduled before it. */
export const idle = () => new Promise(resolve => requestIdleCallback(resolve, { timeout: 2000 }));
/** Saves Settings > Appearance > the author byline switch, as the Settings page does. */
export const setGlobal = (enabled: boolean) => chrome.storage.sync.set({ [BYLINE_STORAGE_KEY]: enabled });
/** Tests stay off the network: without a reader of their own, no avatar has a color. */
const noAccent: ReadAccent = () => Promise.resolve(null);

export interface BylineOptions { showAuthor?: boolean; global?: boolean; dir?: 'rtl'; readAccent?: ReadAccent }

/** Mounts the byline in a title plate and publishes `authors` with its first title. `view.scope` owns it. */
export async function mountByline(
  authors: readonly ContentAuthor[] | null,
  options: BylineOptions = {},
  firstTitle = 'Building a cedar-strip canoe',
  beforePublish?: () => void
) {
  const stage = mountHudStage();
  beforePublish?.();
  const hud = createHud(stage.host, () => {}, stage.clock);
  const scope = new DisposableScope();
  stage.onDispose(() => hud.syncContentTitle(null));
  const settings = createYouTubeSettings();
  await settings.ready;
  if (options.showAuthor === false) await settings.set('youtube', 'showAuthor', false);
  await setGlobal(options.global ?? true);
  // The global switch the view follows, read from the same storage the Settings page writes.
  const global = watchAuthorBylineSetting();
  await global.ready;
  const byline = mountAuthorByline({ scope, bindMenu: bindMenuPopover }, { provider: 'youtube', hosts: HOSTS, settings, global, readAccent: options.readAccent ?? noAccent });
  const publish = (next: readonly ContentAuthor[] | null, title = 'Building a cedar-strip canoe') =>
    hud.syncContentTitle({ title, subtitle: null, authors: next }, byline);
  /** A navigation between items: the title clears before the next one is published. */
  const clear = () => hud.syncContentTitle(null, byline);
  publish(authors, firstTitle);
  const plate = () => queryPlayerUi<HTMLElement>(`.${TITLE_HUD_CLASS}`)!;
  if (options.dir) plate().dir = options.dir;
  const panel = () => plate()?.querySelector<HTMLElement>('.theater-byline-panel') ?? null;
  const popup = () => plate()?.querySelector<HTMLElement>('.theater-byline-popup') ?? null;
  const list = () => popup()!.querySelector<HTMLUListElement>('.theater-byline-list')!;
  const rows = () => [...list().children].map(item => item.firstElementChild as HTMLElement);
  // The visible names; a link's new-tab note is for screen readers only.
  const names = () => {
    const shownNames = panel()?.querySelector('.theater-byline-names');
    return shownNames && [...shownNames.childNodes].filter(node => !(node instanceof Element && node.matches('.theater-byline-sr'))).map(node => node.textContent).join('');
  };
  const links = () => [...plate().querySelectorAll<HTMLAnchorElement>('a.theater-byline-row')];
  const shown = () => getComputedStyle(popup()!).visibility === 'visible';
  /** Opens the list from the keyboard, as ↓ on the focused panel does: pinned, with focus on its first link. */
  const openList = async () => {
    panel()!.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(shown()).toBe(true);
  };
  // Links stay in the test page: every activation is recorded and its navigation stopped.
  const followed: string[] = [];
  getPlayerUiRoot().addEventListener('click', event => {
    const link = (event.target as Element).closest('a');
    if (!link) return;
    event.preventDefault();
    followed.push(link.href);
  }, { capture: true, signal: scope.signal });
  return { scope, hud, publish, clear, plate, panel, names, popup, list, rows, links, shown, openList, followed, settings, stage };
}

export type BylineView = Awaited<ReturnType<typeof mountByline>>;
