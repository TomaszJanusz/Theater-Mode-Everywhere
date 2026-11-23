import { contrastSafeAccent } from '../contrast';
import type { AuthorBylineControl, AuthorBylineHost } from '../core/author-byline';
import type { DisposableScope } from '../core/disposable-scope';
import { languageRuntime, translateMessage } from '../i18n-runtime';
import type { ContentAuthor } from '../media-features/content-title';
import { createSvgIcon } from '../ui/svg-icon';

import { bylineNames, checkedAuthors, monogram, type AuthorHosts } from './author-byline';
import { bylineAllowed, watchAuthorBylineSetting, type AuthorBylineSetting } from './author-byline-setting';
import css from './author-byline-view.css?inline';
import { avatarAccent } from './avatar-accent';
import { rowKeyTarget } from './playlist-panel-view';
import type { ProviderSettingsStore } from './settings';

const STACKED_AVATARS = 3;
/** The avatar is read at this size: enough for its dominant color, and cheap to scan. */
const ACCENT_SAMPLE = 24;
const MAX_ACCENTS = 64;

/** Provider-only fallbacks: these bytes never join content.js. */
const FALLBACKS: Record<string, string> = {
  authorChannelNewTab: 'Opens the channel in a new tab',
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

/**
 * The avatar, or the monogram when there is none or it fails to load: decoration beside the name, kept from assistive
 * technology either way. The image is the host's own CDN, sent no referrer.
 */
function avatar(author: ContentAuthor, className: string): HTMLElement {
  const decorative = <T extends HTMLElement>(node: T) => { node.setAttribute('aria-hidden', 'true'); return node; };
  const fallback = () => decorative(element('span', `${className} theater-byline-monogram`, monogram(author.name)));
  if (!author.avatarUrl) return fallback();
  const image = decorative(element('img', className));
  image.alt = '';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('error', () => image.replaceWith(fallback()), { once: true });
  image.src = author.avatarUrl;
  return image;
}

type ReadAccent = (avatarUrl: string, signal: AbortSignal) => Promise<string | null>;
/** A read under way: its result, and how many callers still want it; the last one to give up cancels it. */
interface AccentRead { result: Promise<string | null>; wanted: number; controller: AbortController }
/** Plate accents by avatar URL: the color, null for none (gray, unreadable or failed), or the read under way. */
const accents = new Map<string, string | null | AccentRead>();
const settledAccent = (value: string | null | AccentRead | undefined): value is string | null => value === null || typeof value === 'string';

/**
 * The plate's accent from the avatar at `url`, read once per URL. It reads a CORS copy of the avatar, so the image on
 * show is left as it is: a plain cross-origin image cannot be read back. Every avatar CDN sends
 * Access-Control-Allow-Origin today; one that stops, or any other failure, leaves the user's accent. When every caller
 * has aborted, the read stops before it draws or samples anything, gives null and leaves the URL unread.
 */
export function readAvatarAccent(url: string, signal?: AbortSignal): Promise<string | null> {
  const known = accents.get(url);
  if (settledAccent(known)) return Promise.resolve(known);
  if (signal?.aborted) return Promise.resolve(null);
  let read = known;
  if (!read) {
    if (accents.size >= MAX_ACCENTS) accents.delete(accents.keys().next().value!);
    const controller = new AbortController();
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';
    image.src = url;
    // Decoding runs off the main thread; drawing and reading wait for the page to be idle again.
    const result = image.decode().then(() => new Promise(resolve => requestIdleCallback(resolve, { timeout: 1000 }))).then(() => {
      if (controller.signal.aborted) return null;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = ACCENT_SAMPLE;
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(image, 0, 0, ACCENT_SAMPLE, ACCENT_SAMPLE);
      return avatarAccent(context.getImageData(0, 0, ACCENT_SAMPLE, ACCENT_SAMPLE).data);
    }).catch(() => null).then(accent => {
      if (accents.get(url) === entry) {
        if (controller.signal.aborted) accents.delete(url);
        else accents.set(url, accent);
      }
      return accent;
    });
    const entry: AccentRead = { result, wanted: 0, controller };
    accents.set(url, entry);
    read = entry;
  }
  const entry = read;
  entry.wanted++;
  signal?.addEventListener('abort', () => { if (--entry.wanted === 0) entry.controller.abort(); }, { once: true });
  return entry.result;
}

/** Runs `task` when the page is idle, at the latest after a second; the scope's end cancels it. */
function whenIdle(scope: DisposableScope, task: () => void): () => void {
  const handle = requestIdleCallback(task, { timeout: 1000 });
  const forget = scope.add(() => cancelIdleCallback(handle));
  return () => { cancelIdleCallback(handle); forget(); };
}

/**
 * The first author's avatar colors the panel (its fill, lit edge and tip) in place of the user's accent; the popup
 * keeps the user's. The color is read when the page is idle and applied only while that avatar still leads the panel;
 * until then, and for an avatar with no usable color, the panel keeps the user's accent. High contrast takes the
 * color's contrast-safe shade, as it does for the user's accent. Returns the function that follows the leading avatar.
 */
function avatarAccentFollower(panel: HTMLElement, scope: DisposableScope, readAccent: ReadAccent): (author: ContentAuthor) => void {
  let current: { id: string; url: string | null } | null = null;
  let cancel = () => {};
  // The panel's end (the byline turned off, theater left) stops a read that has not drawn yet.
  scope.add(() => cancel());
  const paint = (accent: string | null) => {
    if (accent) {
      panel.style.setProperty('--accent-color', accent);
      panel.style.setProperty('--contrast-accent', contrastSafeAccent(accent));
    } else {
      panel.style.removeProperty('--accent-color');
      panel.style.removeProperty('--contrast-accent');
    }
  };
  return author => {
    const url = author.avatarUrl;
    if (author.id === current?.id && url === current.url) return;
    // The same channel republished with another size of its avatar keeps its color until the new one is read.
    const sameAuthor = author.id === current?.id;
    current = { id: author.id, url };
    cancel();
    const known = url ? accents.get(url) : null;
    const pending = url !== null && !settledAccent(known);
    if (!pending || !sameAuthor) paint(typeof known === 'string' ? known : null);
    if (!pending) return;
    const controller = new AbortController();
    const forgetIdle = whenIdle(scope, () => {
      void readAccent(url, controller.signal).then(accent => {
        if (!controller.signal.aborted && current?.url === url) paint(accent);
      });
    });
    cancel = () => { forgetIdle(); controller.abort(); };
  };
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

/** A name keeps its own direction inside the panel and the rows, whichever way the interface reads. */
function nameText(name: string, className: string): HTMLElement {
  const text = element('span', className, name);
  text.dir = 'auto';
  return text;
}

/**
 * One author's row in the popup's list. With an admitted channel link the whole row is that link, a real anchor: a
 * click, Enter or Space (see the player's key guard) opens the channel in a new tab, so theater keeps playing; middle
 * and modified clicks and the context menu stay the browser's. Without one it is a plain row.
 */
function renderRow(author: ContentAuthor): HTMLLIElement {
  const row = element(author.url ? 'a' : 'div', 'theater-byline-row');
  const heading = element('div', 'theater-byline-row-heading');
  const name = element('div', 'theater-byline-row-name');
  name.append(nameText(author.name, 'theater-byline-row-title'));
  if (author.verified) name.append(verifiedMark());
  heading.append(name);
  if (author.stat) heading.append(nameText(author.stat, 'theater-byline-row-stat'));
  row.append(avatar(author, 'theater-byline-row-avatar'), heading);
  if (row instanceof HTMLAnchorElement && author.url) {
    row.href = author.url;
    row.target = '_blank';
    row.rel = 'noopener noreferrer';
    // The row's own words start the link's name; the new tab ends it for screen readers.
    const open = element('span', 'theater-byline-row-open');
    open.append(element('span', 'theater-byline-sr', t('authorChannelNewTab')), createSvgIcon(OPEN_ICON));
    row.append(open);
  }
  const item = element('li', '');
  item.append(row);
  return item;
}

interface BylinePanel {
  show(shown: readonly ContentAuthor[], plate: HTMLElement): void;
  /** Closes the popup, takes the panel out and ends its listeners and any avatar read. */
  dispose(): void;
}

/**
 * The panel and its popup, built in a child of the controls' scope: an arrow-shaped button whose gradient leads into
 * the title, and under the plate one block listing a row per author, in the player's menu shell (hover, click, Enter,
 * Space or ↓; ↑/↓ move between rows; Escape and outside presses close it; focus returns to the panel). The stylesheet
 * holds hover intent: the popup shows after 250 ms of hover and stays 300 ms after the pointer leaves.
 */
function buildPanel(host: AuthorBylineHost, readAccent: ReadAccent): BylinePanel {
  const scope = host.scope.child();
  const root = element('div', 'theater-byline');
  // The plate's tooltip is its scrolling title (hud.ts); an empty title keeps it off the panel and its popup.
  root.title = '';
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
  // The rows show each avatar again beside its name; in the panel they are decoration.
  avatars.setAttribute('aria-hidden', 'true');
  const names = element('span', 'theater-byline-names');
  trigger.append(fill, glow, rim, avatars, names);
  // The menu shell's panel; its top padding is the hover bridge from the panel, and the list inside is the block.
  const popup = element('div', 'theater-cc-menu theater-byline-popup');
  const list = element('ul', 'theater-byline-list');
  // A list without bullets keeps its role everywhere only when it says so.
  list.setAttribute('role', 'list');
  popup.append(list);
  root.append(style, trigger, popup);

  const menu = host.bindMenu({
    host: root, trigger, panel: popup, scope,
    firstFocus: () => list.querySelector<HTMLElement>('a') ?? undefined
  });
  const links = () => [...list.querySelectorAll<HTMLAnchorElement>('a.theater-byline-row')];
  scope.listen(trigger, 'keydown', (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    event.stopPropagation();
    menu.open(links()[0] ?? trigger);
  });
  scope.listen(list, 'keydown', (event: KeyboardEvent) => {
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
  const followAvatar = avatarAccentFollower(trigger, scope, readAccent);
  scope.add(() => root.remove());

  let signature: string | undefined;
  return {
    show(shown, plate) {
      const next = JSON.stringify([shown, t('authorChannelNewTab'), t('authorVerified')]);
      if (next === signature && root.parentElement === plate) return;
      signature = next;
      followAvatar(shown[0]);
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
      list.replaceChildren(...shown.map(renderRow));
      if (root.parentElement !== plate) {
        // A new plate (another title row) starts closed.
        menu.close();
        plate.prepend(root);
      }
    },
    dispose() {
      menu.close();
      scope.dispose();
    }
  };
}

/**
 * The author panel at the start of the title plate and its popup (`buildPanel`). It shows only what `checkedAuthors`
 * admits, only while `bylineAllowed` (the global switch and the provider's `showAuthor`, global off wins), and repaints
 * only when that changed. While it cannot show (either switch off or still unread, no authors, or no title) nothing is
 * built or bound and no avatar is loaded or read, so the title row is the one without a byline.
 */
export function mountAuthorByline(
  host: AuthorBylineHost,
  options: {
    provider: string; hosts: AuthorHosts; settings: ProviderSettingsStore;
    /** Stories and tests stand in for the network; providers leave it out. */
    readAccent?: ReadAccent;
    /** Tests hand in the global switch they control; providers leave it out and the view follows storage. */
    global?: AuthorBylineSetting;
  }
): AuthorBylineControl {
  const { scope } = host;
  const global = options.global ?? watchAuthorBylineSetting();
  let authors: readonly ContentAuthor[] | null | undefined;
  let plate: HTMLElement | null = null;
  let panel: BylinePanel | null = null;
  const update = () => {
    if (scope.isDisposed) return;
    const shown = plate && bylineAllowed(global, options.settings, options.provider) ? checkedAuthors(authors, options.hosts) : [];
    if (!plate || !shown.length) {
      panel?.dispose();
      panel = null;
      return;
    }
    panel ??= buildPanel(host, options.readAccent ?? readAvatarAccent);
    panel.show(shown, plate);
  };
  // The view owns the settings store it was given, and the global switch it follows.
  scope.add(() => options.settings.dispose());
  scope.add(() => global.dispose());
  scope.add(options.settings.subscribe(update));
  scope.add(global.subscribe(update));
  scope.add(languageRuntime.subscribe(update));

  return {
    render(next, target) {
      authors = next;
      plate = target;
      update();
    }
  };
}
