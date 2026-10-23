import { translateMessage } from '../i18n-runtime';

import { KEY_LABEL_FALLBACKS, shortcutSeparator, shortcutTokens, type ShortcutDisplayEnv } from './shortcut-display';
import { shortcutDisplayEnv } from './shortcuts';

/** A shortcut's caps: `<kbd>` elements, optionally joined by the platform's `+`. */
const KEY_RUN = /<kbd>.*?<\/kbd>(?:\+?<kbd>.*?<\/kbd>)*/g;

/**
 * Renders localized text whose `<kbd>key</kbd>` spans become shared key-cap elements. Each shortcut (a run
 * of caps) sits in its own left-to-right isolate: caps describe physical keys, so `Ctrl+←` and `⌃⇧K` keep
 * their order inside Arabic or Hebrew text, where the neutral `+` and glyphs would otherwise reorder.
 */
export function renderKbdText(el: HTMLElement, rawText: string): void {
  el.textContent = '';
  let last = 0;
  for (const run of rawText.matchAll(KEY_RUN)) {
    if (run.index > last) el.appendChild(document.createTextNode(rawText.slice(last, run.index)));
    const group = createKeysGroup();
    let tail = 0;
    for (const cap of run[0].matchAll(/<kbd>(.*?)<\/kbd>/g)) {
      if (cap.index > tail) group.append(run[0].slice(tail, cap.index));
      const kbd = document.createElement('kbd');
      kbd.textContent = cap[1];
      group.append(kbd);
      tail = cap.index + cap[0].length;
    }
    el.appendChild(group);
    last = run.index + run[0].length;
  }
  if (last < rawText.length) el.appendChild(document.createTextNode(rawText.slice(last)));
}

/** The shared isolated left-to-right wrapper for key caps; `dir` also gives it `unicode-bidi: isolate`. */
function createKeysGroup(): HTMLSpanElement {
  const group = document.createElement('span');
  group.className = 'theater-keys';
  group.dir = 'ltr';
  return group;
}

/** The display environment with spoken key names in the UI language; for the extension's own documents. */
export function spokenShortcutEnv(): ShortcutDisplayEnv {
  return { ...shortcutDisplayEnv(), spoken: message => translateMessage(KEY_LABEL_FALLBACKS, message) };
}

/**
 * Renders a stored shortcut as one `<kbd>` cap per key, in a left-to-right row; empty when unassigned.
 * A glyph or abbreviated cap (←, ⌘, Esc) carries its spoken name, so screen readers say the key, not the symbol.
 */
export function renderShortcutCaps(container: HTMLElement, stored: string, env: ShortcutDisplayEnv = spokenShortcutEnv()): void {
  const separator = shortcutSeparator(env.platform);
  container.dir = 'ltr';
  container.replaceChildren();
  shortcutTokens(stored, env).forEach((token, index) => {
    if (index > 0 && separator) container.append(separator);
    const kbd = document.createElement('kbd');
    kbd.textContent = token.text;
    // `aria-label` is prohibited on a bare `<kbd>` (generic role) and ignored by screen readers; an image role makes the name count.
    if (token.label !== token.text) {
      kbd.setAttribute('role', 'img');
      kbd.setAttribute('aria-label', token.label);
    }
    container.append(kbd);
  });
}
