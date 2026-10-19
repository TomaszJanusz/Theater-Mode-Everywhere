import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { CHROME_LIMITS } from './print-store-listing';

const listingsRoot = path.resolve(__dirname, '../store-listings');
const chromeRoot = path.join(listingsRoot, 'chrome');
const amoRoot = path.join(listingsRoot, 'amo');
const extensionLocalesRoot = path.resolve(__dirname, '../_locales');

function listingLocales(root: string, extension: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => entry.name.slice(0, -extension.length))
    .sort();
}

function readChromeLong(locale: string): string {
  return readFileSync(path.join(chromeRoot, `${locale}.txt`), 'utf8');
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
  const locales = listingLocales(chromeRoot, '.txt');

  it('keeps Chrome, AMO and extension locale sets aligned', () => {
    assert.deepEqual(listingLocales(amoRoot, '.md'), locales);
    assert.deepEqual(
      readdirSync(extensionLocalesRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(),
      locales
    );
  });

  it('has a non-empty long description per Chrome locale within 16,000 characters', () => {
    for (const locale of locales) {
      const long = readChromeLong(locale).trim();
      assert.ok(long.length > 0, `chrome/${locale}.txt is empty`);
      assert.ok(long.length <= CHROME_LIMITS.long, `chrome/${locale}.txt has ${long.length} characters`);
    }
  });

  it('keeps the name and short description in the locale messages within store limits', () => {
    for (const locale of locales) {
      const { extensionName, extensionDescription, extensionNameCompact } = readCatalog(locale);
      const name = extensionName?.message ?? '';
      const short = extensionDescription?.message ?? '';
      assert.ok(name.trim(), `${locale}: extensionName is empty`);
      assert.ok(short.trim(), `${locale}: extensionDescription is empty`);
      assert.ok(name.length <= CHROME_LIMITS.name, `${locale}: extensionName has ${name.length} characters`);
      assert.doesNotMatch(short, /\n/, `${locale}: extensionDescription must be one line`);
      assert.ok(short.length <= CHROME_LIMITS.short, `${locale}: extensionDescription has ${short.length} characters`);
      assert.ok(extensionNameCompact?.message && extensionNameCompact.message.length <= 50,
        `${locale}: extensionNameCompact is missing or exceeds the AMO limit`);
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

  it('keeps the AMO name, summary and description aligned with the locale messages and long description', () => {
    for (const locale of locales) {
      const messages = readCatalog(locale);
      const amo = readAmo(locale);
      assert.equal(amoSection(amo, 'Name'), messages.extensionNameCompact?.message,
        `${locale}: AMO name differs from extensionNameCompact`);
      assert.equal(amoSection(amo, 'Summary'), messages.extensionDescription?.message, `${locale}: summary differs`);
      assert.equal(amoSection(amo, 'Description'), readChromeLong(locale).trim(), `${locale}: description differs`);
    }
  });

  it('contains no angle brackets or HTML entities in store copy', () => {
    for (const locale of locales) {
      const copies = [
        [`chrome/${locale}`, readChromeLong(locale)] as const,
        [`chrome/${locale} name`, readCatalog(locale).extensionName!.message!] as const,
        [`chrome/${locale} short`, readCatalog(locale).extensionDescription!.message!] as const,
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
