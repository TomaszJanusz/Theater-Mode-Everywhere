import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

import { PLAYER_I18N_FALLBACKS } from './messages';
import { SHORTCUT_HELP_GROUPS, SHORTCUT_LABELS, shortcutHelpRowLabel } from './shortcut-groups';
import { defaultShortcuts } from './shortcuts';

const english: Record<string, { message: string }> = JSON.parse(readFileSync(new URL('../../_locales/en/messages.json', import.meta.url), 'utf8'));

it('lists every shortcut in exactly one help row', () => {
  const listed = SHORTCUT_HELP_GROUPS.flatMap(group => group.rows.flatMap(row => row.actions));
  assert.deepEqual([...listed].sort(), Object.keys(defaultShortcuts).sort());
});

it('names every group, row and action with English copy the player can fall back to', () => {
  const keys = [
    ...SHORTCUT_HELP_GROUPS.map(group => group.title),
    ...SHORTCUT_HELP_GROUPS.flatMap(group => group.rows.map(shortcutHelpRowLabel)),
    ...Object.values(SHORTCUT_LABELS)
  ];
  for (const key of keys) {
    assert.ok(english[key], `${key} is missing from _locales/en`);
    assert.equal(PLAYER_I18N_FALLBACKS[key], english[key].message, `${key} player fallback`);
  }
});

it('labels a shared row itself, never by one of its halves', () => {
  for (const row of SHORTCUT_HELP_GROUPS.flatMap(group => group.rows)) {
    assert.equal(row.label === undefined, row.actions.length === 1, row.actions.join(' '));
  }
});
