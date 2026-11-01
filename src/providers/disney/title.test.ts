import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findDisneyContentTitle, readDisneyPlayerHeader, resolveDisneyTitle } from './title';

describe('disney playing title', () => {
  const venomId = '6f5b1fff-75da-44f6-9553-412699bf4065';
  const phoenixId = '180356b5-0596-4333-891f-e48c526a0803';
  const collection = {
    items: [
      { id: venomId, text: { title: { full: 'Venom' } } },
      { id: phoenixId, text: { title: { full: 'X-Men: Mroczna Phoenix' } } }
    ]
  };

  it('keeps a collection mate from replacing the film that is playing', () => {
    assert.equal(findDisneyContentTitle(collection), 'Venom');
    assert.equal(findDisneyContentTitle(collection, phoenixId), 'X-Men: Mroczna Phoenix');
    assert.equal(findDisneyContentTitle(collection, '00000000-0000-4000-8000-000000000000'), null);
  });

  it('follows the player chrome when the browse title is still Venom', () => {
    const resolved = resolveDisneyTitle({
      playId: phoenixId,
      previousPlayId: null,
      title: 'Venom',
      source: 'page',
      playerChrome: 'X-Men: Mroczna Phoenix',
      playbackTitle: null,
      documentTitle: 'Venom | Disney+',
      openGraphTitle: 'Venom'
    });
    assert.equal(resolved.title, 'X-Men: Mroczna Phoenix');
    assert.equal(resolved.source, 'chrome');
    assert.equal(resolved.changed, true);
  });

  it('prefers the document title over a stale open-graph title', () => {
    const resolved = resolveDisneyTitle({
      playId: phoenixId,
      previousPlayId: null,
      title: 'Venom',
      source: 'page',
      playerChrome: null,
      playbackTitle: null,
      documentTitle: 'X-Men: Mroczna Phoenix | Disney+',
      openGraphTitle: 'Venom'
    });
    assert.equal(resolved.title, 'X-Men: Mroczna Phoenix');
    assert.equal(resolved.source, 'page');
  });

  it('lets the playback title replace a stale page title', () => {
    const resolved = resolveDisneyTitle({
      playId: phoenixId,
      previousPlayId: phoenixId,
      title: 'Venom',
      source: 'page',
      playerChrome: null,
      playbackTitle: 'X-Men: Mroczna Phoenix',
      documentTitle: 'Venom | Disney+',
      openGraphTitle: 'Venom'
    });
    assert.equal(resolved.title, 'X-Men: Mroczna Phoenix');
    assert.equal(resolved.source, 'playback');
  });

  it('does not let the open-graph title replace the player chrome', () => {
    const resolved = resolveDisneyTitle({
      playId: phoenixId,
      previousPlayId: phoenixId,
      title: 'X-Men: Mroczna Phoenix',
      source: 'chrome',
      playerChrome: 'X-Men: Mroczna Phoenix',
      playbackTitle: 'Venom',
      documentTitle: 'Venom | Disney+',
      openGraphTitle: 'Venom'
    });
    assert.equal(resolved.title, 'X-Men: Mroczna Phoenix');
    assert.equal(resolved.source, 'chrome');
    assert.equal(resolved.changed, false);
  });

  it('reads the player header and keeps the localized episode label opaque', () => {
    assert.deepEqual(readDisneyPlayerHeader({
      data: { playerExperience: { title: 'VisionQuest', subtitle: ' S1:O1  Wyzwolenie ', internalTitle: 'VisionQuest - s1e1' } }
    }), { title: 'VisionQuest', subtitle: 'S1:O1 Wyzwolenie' });
    assert.deepEqual(readDisneyPlayerHeader({ data: { playerExperience: { title: 'Venom', subtitle: '' } } }), { title: 'Venom', subtitle: null });
    assert.equal(readDisneyPlayerHeader({ data: { playerExperience: { subtitle: 'S1:O1 Wyzwolenie' } } }), null);
    assert.equal(readDisneyPlayerHeader({ data: { page: { title: 'VisionQuest' } } }), null);
  });

  it('lets the player header outrank chrome and replace an older header for the same play', () => {
    const fromChrome = resolveDisneyTitle({
      playId: phoenixId,
      previousPlayId: phoenixId,
      title: 'X-Men',
      source: 'chrome',
      playerHeader: 'X-Men: Mroczna Phoenix',
      playerChrome: 'X-Men',
      playbackTitle: null,
      documentTitle: null,
      openGraphTitle: null
    });
    assert.deepEqual(fromChrome, { title: 'X-Men: Mroczna Phoenix', source: 'player', changed: true });
    const newer = resolveDisneyTitle({
      playId: phoenixId,
      previousPlayId: phoenixId,
      title: 'X-Men: Mroczna Phoenix',
      source: 'player',
      playerHeader: 'Dark Phoenix',
      playerChrome: 'X-Men',
      playbackTitle: null,
      documentTitle: null,
      openGraphTitle: null
    });
    assert.deepEqual(newer, { title: 'Dark Phoenix', source: 'player', changed: true });
  });
});
