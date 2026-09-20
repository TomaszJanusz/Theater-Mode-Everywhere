import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  AMO_LOCALE_SOURCES,
  buildAmoPayload,
  createAmoJwt,
  parseAmoListing,
  parseCliOptions,
  validateAmoPayload,
} from './update-amo-listings';

const listingsRoot = path.resolve(__dirname, '../store-listings/amo');

describe('AMO listing updater', () => {
  it('parses listing fields without including headings or suggested tags', () => {
    const listing = parseAmoListing(`# AMO Listing - en

## Name
Example

## Summary
Short summary

## Description
Description with \`Markdown\`.

## Suggested tags
one, two
`);

    assert.deepEqual(listing, {
      summary: 'Short summary',
      description: 'Description with `Markdown`.',
    });
  });

  it('matches the existing AMO locales and fans Spanish out to country variants', () => {
    const payload = buildAmoPayload(listingsRoot);
    const expectedLocales = [
      'de', 'en-US', 'es-AR', 'es-CL', 'es-ES', 'es-MX', 'fr', 'it',
      'ja', 'ko', 'pl', 'pt-BR', 'ru', 'uk', 'zh-CN',
    ];

    assert.deepEqual(Object.keys(payload).sort(), ['description', 'summary']);
    assert.deepEqual(Object.keys(payload.summary).sort(), expectedLocales.sort());
    assert.equal(payload.description['es-AR'], payload.description['es-ES']);
    assert.equal(payload.description['es-CL'], payload.description['es-MX']);
    assert.ok(!('ar' in payload.summary));
    assert.deepEqual(AMO_LOCALE_SOURCES.pt_BR, ['pt-BR']);
    assert.deepEqual(AMO_LOCALE_SOURCES.zh_CN, ['zh-CN']);
  });

  it('allows a credential-free dry run but requires both JWT credential values for writes', () => {
    const dryRun = parseCliOptions(['--', '--addon-id', 'example', '--dry-run'], {});
    assert.equal(dryRun.addonId, 'example');
    assert.equal(dryRun.dryRun, true);

    assert.throws(
      () => parseCliOptions(['--addon-id', 'example'], {}),
      /Missing --api-key/
    );
    assert.throws(
      () => parseCliOptions(['--addon-id', 'example', '--api-key', 'user:1:2'], {}),
      /Missing --api-secret/
    );
  });

  it('creates a valid HS256 JWT with a one-minute lifetime', () => {
    const token = createAmoJwt('user:1:2', 'secret', 1_700_000_000);
    const [header, payload, signature] = token.split('.');
    const decodedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as unknown;
    const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      iss: string;
      iat: number;
      exp: number;
      jti: string;
    };
    const expectedSignature = createHmac('sha256', 'secret')
      .update(`${header}.${payload}`)
      .digest('base64url');

    assert.deepEqual(decodedHeader, { alg: 'HS256', typ: 'JWT' });
    assert.equal(decodedPayload.iss, 'user:1:2');
    assert.equal(decodedPayload.iat, 1_700_000_000);
    assert.equal(decodedPayload.exp, 1_700_000_060);
    assert.ok(decodedPayload.jti);
    assert.equal(signature, expectedSignature);
  });

  it('rejects every HTML entity form and raw angle brackets before upload', () => {
    for (const unsafe of ['&lt;', '&#60;', '&#x3c;', '<', '>']) {
      assert.throws(
        () => validateAmoPayload({ summary: { de: unsafe }, description: { de: 'safe' } }),
        /AMO may/
      );
    }
  });
});
