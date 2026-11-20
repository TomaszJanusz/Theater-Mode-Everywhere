import type { AuthorBylineControl, AuthorBylineHost } from '../core/author-byline';
import { languageRuntime, translateMessage } from '../i18n-runtime';
import type { ContentAuthor } from '../media-features/content-title';
import { createSvgIcon } from '../ui/svg-icon';

import { bylineNames, checkedAuthors, monogram, type AuthorHosts } from './author-byline';
import css from './author-byline-view.css?inline';
import { rowKeyTarget } from './playlist-panel-view';
import type { ProviderSettingsStore } from './settings';

const STACKED_AVATARS = 3;

/** Provider-only fallbacks: these bytes never join content.js. */
const FALLBACKS: Record<string, string> = {
  authorOpenChannel: 'Open channel',
  authorOpenChannelLabel: '$1, opens in a new tab',
  authorVerified: 'Verified'
};
const t = (key: string, substitutions?: string[]) => translateMessage(FALLBACKS, key, substitutions);

/** Every name, joined as the interface language lists them. */
function listedNames(authors: readonly ContentAuthor[]): string {
  const locale = translateMessage({ '@@ui_locale': '' }, '@@ui_locale').replace('_', '-');
  let format: Intl.ListFormat;
  try {
    format = new Intl.ListFormat(locale || undefined, { type: 'conjunction' });
  } catch {
    format = new Intl.ListFormat(undefined, { type: 'conjunction' });
  }
  return format.format(authors.map(author => author.name));
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The avatar, or the monogram when there is none or it fails to load. The image is the host's own CDN, sent no referrer. */
function avatar(author: ContentAuthor, className: string): HTMLElement {
  const fallback = () => element('span', `${className} theater-byline-monogram`, monogram(author.name));
  if (!author.avatarUrl) return fallback();
  const image = element('img', className);
  image.alt = '';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('error', () => image.replaceWith(fallback()), { once: true });
  image.src = author.avatarUrl;
  return image;
}

/** A disc with the check cut out, so the plate shows through it. */
const VERIFIED_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.6 14.2-4.3-4.3 1.5-1.5 2.8 2.8 5.9-5.9 1.5 1.5Z"/></svg>';
const OPEN_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';

function verifiedMark(): HTMLElement {
  const mark = element('span', 'theater-byline-verified');
  mark.setAttribute('role', 'img');
  mark.setAttribute('aria-label', t('authorVerified'));
  mark.append(createSvgIcon(VERIFIED_ICON));
  return mark;
}

/** A name keeps its own direction inside the panel and the cards, whichever way the interface reads. */
function nameText(name: string, className: string): HTMLElement {
  const text = element('span', className, name);
  text.dir = 'auto';
  return text;
}

function renderCard(author: ContentAuthor): HTMLElement {
  const card = element('div', 'theater-byline-card');
  const heading = element('div', 'theater-byline-card-heading');
  const name = element('div', 'theater-byline-card-name');
  name.append(nameText(author.name, 'theater-byline-card-title'));
  if (author.verified) name.append(verifiedMark());
  heading.append(name);
  if (author.stat) heading.append(nameText(author.stat, 'theater-byline-card-stat'));
  card.append(avatar(author, 'theater-byline-card-avatar'), heading);
  if (author.url) {
    // A real link: a click opens the channel in a new tab, so theater keeps playing; middle and modified clicks and
    // the context menu stay the browser's.
    const link = element('a', 'theater-byline-open');
    link.href = author.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    // The visible words start the link's name; whose channel it is and the new tab follow for screen readers.
    link.append(element('span', '', t('authorOpenChannel')), element('span', 'theater-byline-sr', ` ${t('authorOpenChannelLabel', [author.name])}`));
    link.append(createSvgIcon(OPEN_ICON));
    card.append(link);
  }
  return card;
}

/**
 * The author panel at the start of the title plate and its cards: an arrow-shaped button whose gradient leads into the
 * title, and one card per author under the plate, in the player's menu shell (hover, click, Enter, Space or ↓; Escape
 * and outside presses close it; focus returns to the panel). The stylesheet holds hover intent: the cards show after
 * 250 ms of hover and stay 300 ms after the pointer leaves. It shows only what
 * `checkedAuthors` admits, only while the provider's `showAuthor` setting is on, and repaints only when that changed.
 */
export function mountAuthorByline(
  host: AuthorBylineHost,
  options: { provider: string; hosts: AuthorHosts; settings: ProviderSettingsStore }
): AuthorBylineControl {
  const { scope } = host;
  const root = element('div', 'theater-byline');
  const style = element('style', '');
  style.textContent = css;
  const trigger = element('button', 'theater-byline-panel');
  trigger.type = 'button';
  // The fill and its lit edge are decoration behind the names.
  const fill = element('span', 'theater-byline-fill');
  const glow = element('span', 'theater-byline-glow');
  glow.append(element('span', ''));
  const rim = element('span', 'theater-byline-rim');
  for (const part of [fill, glow, rim]) part.setAttribute('aria-hidden', 'true');
  const avatars = element('span', 'theater-byline-avatars');
  // The cards show each avatar again beside its name; in the panel they are decoration.
  avatars.setAttribute('aria-hidden', 'true');
  const names = element('span', 'theater-byline-names');
  trigger.append(fill, glow, rim, avatars, names);
  const cards = element('div', 'theater-cc-menu theater-byline-cards');
  cards.setAttribute('role', 'group');
  root.append(style, trigger, cards);

  const menu = host.bindMenu({
    host: root, trigger, panel: cards, scope,
    firstFocus: () => cards.querySelector<HTMLElement>('a') ?? undefined
  });
  const links = () => [...cards.querySelectorAll<HTMLAnchorElement>('a.theater-byline-open')];
  scope.listen(trigger, 'keydown', (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    event.stopPropagation();
    menu.open(links()[0] ?? trigger);
  });
  scope.listen(cards, 'keydown', (event: KeyboardEvent) => {
    const all = links();
    const index = all.indexOf(event.target as HTMLAnchorElement);
    const target = index < 0 ? -1 : rowKeyTarget(event.key, index, all.length);
    if (target < 0) return;
    event.preventDefault();
    event.stopPropagation();
    all[target].focus({ preventScroll: true });
  });
  // The plate stops presses from reaching the picture, so outside presses are watched from the window.
  scope.listen(window, 'pointerdown', (event: PointerEvent) => {
    if (!event.composedPath().includes(root)) menu.close();
  }, { capture: true });

  let authors: readonly ContentAuthor[] | null | undefined;
  let plate: HTMLElement | null = null;
  let signature: string | undefined;
  const update = () => {
    if (scope.isDisposed) return;
    const shown = options.settings.loaded && options.settings.values[options.provider]?.showAuthor
      ? checkedAuthors(authors, options.hosts)
      : [];
    const next = JSON.stringify([shown, t('authorOpenChannel')]);
    if (next === signature && (!shown.length || root.parentElement === plate)) return;
    signature = next;
    if (!shown.length || !plate) {
      menu.close();
      root.remove();
      return;
    }
    const { names: visible, more } = bylineNames(shown);
    avatars.replaceChildren(...shown.slice(0, STACKED_AVATARS).map(author => avatar(author, 'theater-byline-avatar')));
    names.replaceChildren();
    visible.forEach((name, index) => {
      if (index) names.append(element('span', 'theater-byline-and', '&'));
      names.append(nameText(name, 'theater-byline-name'));
    });
    if (shown.length === 1 && shown[0].verified) names.append(verifiedMark());
    // The visible label is the accessible name; with three or more authors it starts the list of every name, and the
    // count, which a listener would not need, stays out of it.
    if (more) {
      const count = element('span', 'theater-byline-more', `+${more}`);
      count.setAttribute('aria-hidden', 'true');
      names.append(count);
      trigger.setAttribute('aria-label', listedNames(shown));
    } else trigger.removeAttribute('aria-label');
    cards.replaceChildren(...shown.map(renderCard));
    if (root.parentElement !== plate) {
      // A new plate (another title row) starts closed.
      menu.close();
      plate.prepend(root);
    }
  };
  // The view owns the settings store it was given.
  scope.add(() => options.settings.dispose());
  scope.add(options.settings.subscribe(update));
  scope.add(languageRuntime.subscribe(update));
  scope.add(() => root.remove());

  return {
    render(next, target) {
      authors = next;
      plate = target;
      update();
    }
  };
}
