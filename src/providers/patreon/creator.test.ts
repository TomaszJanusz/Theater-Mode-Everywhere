import assert from 'node:assert/strict';
import { it } from 'node:test';

import { normalizePatreonSnapshot } from './snapshot-model';

it('keeps a crossed Patreon creator only with its post id, a vanity id and a name', () => {
  const author = { id: 'pastaclub', name: 'Digital Pasta', url: 'https://www.patreon.com/cw/pastaclub', avatarUrl: null, verified: true, stat: '9 members' };
  assert.deepEqual(normalizePatreonSnapshot({ creator: { postId: '175727423', author } })?.creator,
    { postId: '175727423', author: { ...author, verified: false, stat: null } }, 'Patreon has no badge or figure to show');
  for (const creator of [{ author }, { postId: 'film-club', author }, { postId: '1', author: { ...author, id: 'a/b' } }, { postId: '1', author: { ...author, name: '' } }, 'pastaclub']) {
    assert.equal(normalizePatreonSnapshot({ creator })?.creator, undefined, JSON.stringify(creator));
  }
  assert.equal('creator' in normalizePatreonSnapshot({})!, false, 'a snapshot without a creator stays as it was');
});
