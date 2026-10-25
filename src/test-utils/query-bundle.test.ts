import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bundleQueryModules } from './query-bundle';

describe('query-import bundles', () => {
  it('inlines ?raw imports as text and caches one build per entry set', async () => {
    const entry = ["export { default as license } from '../../LICENSE?raw';"];
    const text = await bundleQueryModules(entry, 'Raw');
    assert.match(text, /Permission is hereby granted/);
    assert.equal(await bundleQueryModules(entry, 'Raw'), text);
    assert.notEqual(await bundleQueryModules(entry, 'Other'), text);
  });
});
