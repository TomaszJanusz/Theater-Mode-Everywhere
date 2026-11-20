import assert from 'node:assert/strict';
import { it } from 'node:test';

import type { ShortcutDisplayEnv } from '../src/ui/shortcut-display';

import { matchesShortcutSearch, normalizeSearchText, shortcutSearchTerms } from './shortcut-search';

const windows: ShortcutDisplayEnv = { platform: 'windows' };
const mac: ShortcutDisplayEnv = { platform: 'mac' };
const item = (text: string[], stored: string, env = windows) => ({ text, keys: shortcutSearchTerms(stored, env) });
const playlist = item(['Toggle playlist'], 'Shift+Q');

it('an empty or blank query matches every row, including unassigned ones', () => {
  for (const query of ['', '   ', '\t']) assert.equal(matchesShortcutSearch(query, item(['Next'], '')), true);
});

it('finds a row by any part of its name or description, ignoring case, accents and extra spaces', () => {
  assert.equal(matchesShortcutSearch('PLAYLIST', playlist), true);
  assert.equal(matchesShortcutSearch('  toggle   play ', playlist), true);
  assert.equal(matchesShortcutSearch('plein ecran', item(['Plein écran'], 'F')), true);
  assert.equal(matchesShortcutSearch('przelacz', item(['Przełącz napisy'], 'C')), true, 'ł folds to l');
  assert.equal(matchesShortcutSearch('ｐｌａｙ', playlist), true, 'full-width letters from an IME');
  assert.equal(matchesShortcutSearch('works only', item(['Switch Video on Page', 'Works only when the page has more than one HTML5 video.'], 'Shift+T')), true);
  assert.equal(matchesShortcutSearch('volume', playlist), false);
});

it('finds a row by its assigned key, modifier by modifier and in any order', () => {
  for (const query of ['shift', 'q', 'Shift+Q', 'shift q', 'q+shift', 'sh']) assert.equal(matchesShortcutSearch(query, playlist), true, query);
  const chat = item(['Toggle chat'], 'Alt+R');
  assert.equal(matchesShortcutSearch('alt+r', chat), true);
  assert.equal(matchesShortcutSearch('alt+', chat), true, 'a half-typed chord keeps matching');
  assert.equal(matchesShortcutSearch('alt+p', chat), false);
  assert.equal(matchesShortcutSearch('ctrl', chat), false);
  assert.equal(matchesShortcutSearch('shift', item(['Next'], '')), false, 'unassigned rows have no keys');
});

it('finds keys by legend, spoken name and stored name on every platform', () => {
  const seek = item(['Seek Backward (5s)'], 'ArrowLeft');
  for (const query of ['←', 'left', 'arrow', 'arrowleft']) assert.equal(matchesShortcutSearch(query, seek), true, query);
  const macPlaylist = item(['Toggle playlist'], 'Shift+Q', mac);
  for (const query of ['⇧', 'shift', 'shift+q']) assert.equal(matchesShortcutSearch(query, macPlaylist), true, query);
  assert.equal(matchesShortcutSearch('esc', item(['Exit'], 'Escape')), true);
  assert.equal(matchesShortcutSearch('+', item(['Bigger subtitles'], '+')), true, 'the plus key itself');
  assert.equal(matchesShortcutSearch('+', playlist), false);
  assert.equal(matchesShortcutSearch('<', item(['Slower'], '<')), true);
});

it('follows the keyboard layout and the language of spoken names', () => {
  const azerty: ShortcutDisplayEnv = { platform: 'windows', layout: new Map([['KeyW', 'z']]), spoken: key => key === 'keyLabelArrowLeft' ? 'Strzałka w lewo' : undefined };
  assert.equal(matchesShortcutSearch('z', item(['Navigate up'], 'KeyW', azerty)), true, 'the legend printed on the key');
  assert.equal(matchesShortcutSearch('strzalka lewo', item(['Seek'], 'ArrowLeft', azerty)), true);
});

it('normalizes text once for both sides', () => {
  assert.equal(normalizeSearchText('  Ａｌｔ  +  Ｐ '), 'alt + p');
  assert.equal(normalizeSearchText('Plein ÉCRAN'), 'plein ecran');
});
