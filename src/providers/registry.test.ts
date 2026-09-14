import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultMediaProviderFlags } from '../media-features/provider-flags';
import {
  matchingProviders,
  markFetchPatched,
  markMainWorldBooted,
  shouldAttachProvider,
  shouldPatchMainWorld
} from './registry';
import { isDisneyHost, isYouTubeHost } from './hosts';

describe('provider registry', () => {
  it('matches provider hosts used for MAIN patches', () => {
    assert.deepEqual(matchingProviders('www.youtube-nocookie.com').filter((id) => id !== 'native'), ['youtube']);
    assert.equal(shouldPatchMainWorld('www.youtube.com'), true);
    assert.equal(shouldPatchMainWorld('www.disneyplus.com'), true);
    assert.equal(shouldPatchMainWorld('example.com'), false);
    assert.equal(isYouTubeHost('www.youtube-nocookie.com'), true);
    assert.equal(isDisneyHost('www.disneyplus.com'), true);
  });

  it('honors provider flags when attaching adapters', () => {
    const flags = { ...defaultMediaProviderFlags(), youtube: false };
    assert.equal(shouldAttachProvider('youtube', flags, 'www.youtube.com'), false);
    assert.equal(shouldAttachProvider('vimeo', defaultMediaProviderFlags(), 'player.vimeo.com'), true);
  });

  it('marks MAIN boot and fetch patches as idempotent', () => {
    const target: Record<symbol, unknown> = {};
    assert.equal(markMainWorldBooted(target), true);
    assert.equal(markMainWorldBooted(target), false);
    assert.equal(markFetchPatched(target), true);
    assert.equal(markFetchPatched(target), false);
  });
});
