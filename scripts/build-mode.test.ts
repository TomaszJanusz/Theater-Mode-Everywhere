import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bundleMinify, resolveBundleBuildMode } from './build-mode';

describe('bundle build mode', () => {
  it('minifies production builds with esbuild', () => {
    assert.equal(resolveBundleBuildMode({}), 'production');
    assert.equal(resolveBundleBuildMode({ TME_BUILD: 'production' }), 'production');
    assert.equal(bundleMinify('production'), 'esbuild');
  });

  it('leaves diagnostic builds unminified', () => {
    assert.equal(resolveBundleBuildMode({ TME_BUILD: ' diagnostic ' }), 'diagnostic');
    assert.equal(bundleMinify('diagnostic'), false);
  });

  it('rejects an unknown mode instead of guessing', () => {
    assert.throws(() => resolveBundleBuildMode({ TME_BUILD: '0' }), /TME_BUILD/);
  });
});
