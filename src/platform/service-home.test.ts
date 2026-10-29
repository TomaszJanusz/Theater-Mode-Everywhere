import assert from 'node:assert/strict';
import { it } from 'node:test';

import { descriptorHomeUrl } from '../providers/descriptor-hosts';

import { serviceHomeUrl } from './service-home';

it('resolves declared homes using descriptor admission, including terminal dots and exact hosts', () => {
  const catalog = [{ hosts: [{ domain: 'example.com', includeSubdomains: true }], home: 'https://www.example.com/' },
    { hosts: [{ domain: 'clip.test', includeSubdomains: false }], home: 'https://clip.test/home' }];
  for (const host of ['example.com', 'embed.example.com', 'EMBED.EXAMPLE.COM.']) assert.equal(descriptorHomeUrl(catalog, host), 'https://www.example.com/');
  assert.equal(descriptorHomeUrl(catalog, 'clip.test.'), 'https://clip.test/home');
  for (const host of ['www.clip.test', 'example.com.evil.test', 'notexample.com']) assert.equal(descriptorHomeUrl(catalog, host), null);
  assert.equal(descriptorHomeUrl([{ hosts: catalog[0].hosts }], 'example.com'), null);
});

it('preserves legacy destinations and generic origin fallback without a declaration', () => {
  assert.equal(serviceHomeUrl('https://player.vimeo.com/video/123'), 'https://vimeo.com/');
  assert.equal(serviceHomeUrl('https://www.youtube.com/watch?v=123'), 'https://www.youtube.com/');
  assert.equal(serviceHomeUrl('https://player.example.test:8443/video'), 'https://player.example.test:8443/');
  assert.equal(serviceHomeUrl('https://vimeo.com.evil.test/'), 'https://vimeo.com.evil.test/');
  for (const url of ['about:blank', 'file:///tmp/video', 'not a url']) assert.equal(serviceHomeUrl(url), null);
});
