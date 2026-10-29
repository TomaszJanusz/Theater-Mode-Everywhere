import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { vimeoPageTitle } from './title';

describe('vimeo page title', () => {
  it('prefers the open-graph title and strips the site suffix', () => {
    assert.equal(
      vimeoPageTitle('Les Bêtes', 'Verify to continue', 'Les Bêtes | Videos & Movies on Vimeo'),
      'Les Bêtes'
    );
    assert.equal(
      vimeoPageTitle(null, 'Verify to continue', 'Les Bêtes | Videos & Movies on Vimeo'),
      'Les Bêtes'
    );
  });

  it('ignores the marketing homepage and login gates', () => {
    assert.equal(vimeoPageTitle('Vimeo', 'Vimeo - All-in-One Video Platform', 'Vimeo'), null);
    assert.equal(vimeoPageTitle(null, 'Log in', 'Join'), null);
  });
});
