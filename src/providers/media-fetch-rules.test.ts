import assert from 'node:assert/strict';
import { it } from 'node:test';

import { matchesMediaFetchRules, type MediaFetchRule } from './media-fetch-rules';

it('admits only declared kinds, exact hosts, HTTPS and matching paths, including redirects', () => {
  const rules: MediaFetchRule[] = [{ kind: 'caption-track', host: 'captions.example.test', pathname: '^/tracks/[a-z]+\\.vtt$' }];
  const allowed = (url: string, kind = 'caption-track') => matchesMediaFetchRules(rules, { kind, url });
  assert.equal(allowed('https://captions.example.test/tracks/en.vtt?sig=opaque'), true);
  assert.equal(matchesMediaFetchRules(rules, { kind: 'caption-track', url: '/tracks/en.vtt' }, 'https://captions.example.test/'), true);
  for (const url of ['http://captions.example.test/tracks/en.vtt', 'https://user@captions.example.test/tracks/en.vtt',
    'https://captions.example.test:8443/tracks/en.vtt', 'https://captions.example.test.evil.test/tracks/en.vtt',
    'https://sub.captions.example.test/tracks/en.vtt', 'https://captions.example.test/stream.mpd', 'https://captions.example.test/license', 'invalid']) assert.equal(allowed(url), false, url);
  assert.equal(allowed('https://captions.example.test/tracks/en.vtt', 'storyboard-vtt'), false);
  assert.equal(matchesMediaFetchRules([], { kind: 'caption-track', url: 'https://captions.example.test/tracks/en.vtt' }), false);
});
