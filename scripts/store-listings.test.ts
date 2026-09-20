import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const listingsRoot = path.resolve(__dirname, '../store-listings');
const chromeRoot = path.join(listingsRoot, 'chrome');
const amoRoot = path.join(listingsRoot, 'amo');
const extensionLocalesRoot = path.resolve(__dirname, '../_locales');

const forbiddenFrameSkippingCopy: Record<string, string[]> = {
  ar: ['تخطي الإطارات'],
  es: ['omitir fotogramas'],
  fr: ['sauter des images', 'les parties les plus lues'],
  it: ['saltare i fotogrammi'],
  ja: ['フレームのスキップ'],
  ko: ['프레임 건너뛰기'],
  pt_BR: ['pular quadros'],
  ru: ['пропуска кадров'],
  uk: ['пропуску кадрів'],
  zh_CN: ['跳帧']
};

function listingLocales(root: string): string[] {
  return readdirSync(root)
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.slice(0, -3))
    .sort();
}

function readListing(store: 'chrome' | 'amo', locale: string): string {
  return readFileSync(path.join(listingsRoot, store, `${locale}.md`), 'utf8');
}

function headings(content: string): string[] {
  return content.match(/^## .+$/gm) ?? [];
}

function normalizedStoreContent(content: string, locale: string): string {
  return content
    .replace(`# Chrome Web Store Listing - ${locale}`, '# STORE')
    .replace(`# AMO Listing - ${locale}`, '# STORE')
    .replace('## Short summary', '## SUMMARY')
    .replace('## Summary', '## SUMMARY')
    .replace('## Full description', '## DESCRIPTION')
    .replace('## Description', '## DESCRIPTION')
    .replace('## Suggested keywords', '## KEYWORDS')
    .replace('## Suggested tags', '## KEYWORDS');
}

describe('store listings', () => {
  const locales = listingLocales(chromeRoot);

  it('keeps Chrome and AMO locale sets aligned', () => {
    assert.deepEqual(listingLocales(amoRoot), locales);
  });

  it('uses the exact field schema for each store', () => {
    for (const locale of locales) {
      assert.deepEqual(headings(readListing('chrome', locale)), [
        '## Name',
        '## Short summary',
        '## Full description',
        '## Suggested keywords'
      ], `chrome/${locale}: unexpected listing fields`);
      assert.deepEqual(headings(readListing('amo', locale)), [
        '## Name',
        '## Summary',
        '## Description',
        '## Suggested tags'
      ], `amo/${locale}: unexpected listing fields`);
    }
  });

  it('keeps Chrome short summaries within 132 characters', () => {
    for (const locale of locales) {
      const content = readListing('chrome', locale);
      const summary = content.match(/## Short summary\n([^\n]+)/)?.[1];
      assert.ok(summary, `chrome/${locale}: missing short summary`);
      assert.ok(summary.length <= 132,
        `chrome/${locale}: short summary has ${summary.length} characters`);
    }
  });

  it('keeps Chrome summaries aligned with localized manifest descriptions', () => {
    for (const locale of locales) {
      const content = readListing('chrome', locale);
      const summary = content.match(/## Short summary\n([^\n]+)/)?.[1];
      assert.ok(summary, `chrome/${locale}: missing short summary`);

      const messages = JSON.parse(
        readFileSync(path.join(extensionLocalesRoot, locale, 'messages.json'), 'utf8')
      ) as Record<string, { message?: string }>;
      assert.equal(
        messages.extensionDescription?.message,
        summary,
        `${locale}: extensionDescription differs from the Chrome short summary`
      );
    }
  });

  it('keeps Chrome and AMO copy aligned within each locale', () => {
    for (const locale of locales) {
      assert.equal(
        normalizedStoreContent(readListing('chrome', locale), locale),
        normalizedStoreContent(readListing('amo', locale), locale),
        `${locale}: Chrome and AMO listing copy differs`
      );
    }
  });

  it('describes frame stepping without implying skipped frames', () => {
    for (const [locale, forbiddenPhrases] of Object.entries(forbiddenFrameSkippingCopy)) {
      for (const store of ['chrome', 'amo'] as const) {
        const content = readListing(store, locale);
        for (const phrase of forbiddenPhrases) {
          assert.ok(!content.includes(phrase),
            `${store}/${locale}: frame stepping uses forbidden copy: ${phrase}`);
        }
      }
    }
  });

  it('contains no angle brackets or HTML entities in store copy', () => {
    for (const locale of locales) {
      for (const store of ['chrome', 'amo'] as const) {
        const content = readListing(store, locale);
        assert.doesNotMatch(content, /[<>]/,
          `${store}/${locale}: angle brackets are unsafe in store copy`);
        assert.doesNotMatch(content, /&(?:#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]+);/,
          `${store}/${locale}: encoded HTML entity would be shown literally`);
      }
    }
  });
});
