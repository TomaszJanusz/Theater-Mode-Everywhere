import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const listingsRoot = path.resolve(__dirname, '../store-listings');
const chromeRoot = path.join(listingsRoot, 'chrome');
const amoRoot = path.join(listingsRoot, 'amo');
const extensionLocalesRoot = path.resolve(__dirname, '../_locales');

function listingLocales(root: string, directories: boolean): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => (directories ? entry.isDirectory() : entry.name.endsWith('.md')))
    .map((entry) => (directories ? entry.name : entry.name.slice(0, -3)))
    .sort();
}

const CHROME_FIELDS = ['name', 'short', 'long', 'keywords'] as const;
type ChromeField = typeof CHROME_FIELDS[number];

function readChrome(locale: string, field: ChromeField): string {
  return readFileSync(path.join(chromeRoot, locale, `${field}.txt`), 'utf8');
}

function readCatalog(locale: string): Record<string, { message?: string }> {
  return JSON.parse(readFileSync(path.join(extensionLocalesRoot, locale, 'messages.json'), 'utf8'));
}

function readAmo(locale: string): string {
  return readFileSync(path.join(amoRoot, `${locale}.md`), 'utf8');
}

function amoSection(content: string, heading: string): string {
  const sections = content.split(/^## /m).slice(1);
  const section = sections.find((text) => text.startsWith(`${heading}\n`));
  assert.ok(section, `missing AMO section ${heading}`);
  return section.slice(heading.length).trim();
}

function headings(content: string): string[] {
  return content.match(/^## .+$/gm) ?? [];
}

describe('store listings', () => {
  const locales = listingLocales(chromeRoot, true);

  it('keeps Chrome and AMO locale sets aligned', () => {
    assert.deepEqual(listingLocales(amoRoot, false), locales);
  });

  it('gives every Chrome locale exactly the separate field files, none empty', () => {
    for (const locale of locales) {
      assert.deepEqual(
        readdirSync(path.join(chromeRoot, locale)).sort(),
        CHROME_FIELDS.map((field) => `${field}.txt`).sort(),
        `chrome/${locale}: unexpected listing files`
      );
      for (const field of CHROME_FIELDS) {
        assert.ok(readChrome(locale, field).trim().length > 0, `chrome/${locale}/${field}.txt is empty`);
      }
    }
  });

  it('keeps the Chrome short description on a single line within 132 characters', () => {
    for (const locale of locales) {
      const summary = readChrome(locale, 'short').trim();
      assert.doesNotMatch(summary, /\n/, `chrome/${locale}: short description must be one line`);
      assert.ok(summary.length <= 132,
        `chrome/${locale}: short description has ${summary.length} characters`);
    }
  });

  it('keeps Chrome short descriptions aligned with localized manifest descriptions', () => {
    for (const locale of locales) {
      assert.equal(
        readCatalog(locale).extensionDescription?.message,
        readChrome(locale, 'short').trim(),
        `${locale}: extensionDescription differs from the Chrome short description`
      );
    }
  });

  it('uses the exact field schema for AMO listings', () => {
    for (const locale of locales) {
      assert.deepEqual(headings(readAmo(locale)), [
        '## Name',
        '## Summary',
        '## Description',
        '## Suggested tags'
      ], `amo/${locale}: unexpected listing fields`);
    }
  });

  it('keeps names aligned with the manifest: Chrome uses the full name, AMO the compact one', () => {
    for (const locale of locales) {
      const messages = readCatalog(locale);
      assert.equal(readChrome(locale, 'name').trim(), messages.extensionName?.message,
        `${locale}: chrome name differs from extensionName`);
      assert.equal(amoSection(readAmo(locale), 'Name'), messages.extensionNameCompact?.message,
        `${locale}: AMO name differs from extensionNameCompact`);
      assert.ok(messages.extensionName!.message!.length <= 75, `${locale}: extensionName exceeds the Chrome limit`);
      assert.ok(messages.extensionNameCompact!.message!.length <= 50, `${locale}: extensionNameCompact exceeds the AMO limit`);
    }
  });

  it('keeps Chrome and AMO copy aligned within each locale', () => {
    for (const locale of locales) {
      const amo = readAmo(locale);
      assert.equal(amoSection(amo, 'Summary'), readChrome(locale, 'short').trim(), `${locale}: summary differs`);
      assert.equal(amoSection(amo, 'Description'), readChrome(locale, 'long').trim(), `${locale}: description differs`);
      assert.equal(amoSection(amo, 'Suggested tags'), readChrome(locale, 'keywords').trim(), `${locale}: keywords differ`);
    }
  });

  it('contains no angle brackets or HTML entities in store copy', () => {
    for (const locale of locales) {
      const copies = [
        ...CHROME_FIELDS.map((field) => [`chrome/${locale}/${field}`, readChrome(locale, field)] as const),
        [`amo/${locale}`, readAmo(locale)] as const
      ];
      for (const [label, content] of copies) {
        assert.doesNotMatch(content, /[<>]/, `${label}: angle brackets are unsafe in store copy`);
        assert.doesNotMatch(content, /&(?:#[0-9]+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]+);/,
          `${label}: encoded HTML entity would be shown literally`);
      }
    }
  });
});
