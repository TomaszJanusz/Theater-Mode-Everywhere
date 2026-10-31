import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { FALLBACK_MESSAGES } from '../src/i18n';
import { LANGUAGES } from '../src/language';
import { PLAYER_I18N_FALLBACKS } from '../src/ui/messages';
import { KEY_LABEL_FALLBACKS } from '../src/ui/shortcut-display';

type MessagePlaceholder = {
  content: string;
};

type MessageEntry = {
  message: string;
  placeholders?: Record<string, MessagePlaceholder>;
};

type MessageCatalog = Record<string, MessageEntry>;

const localesRoot = path.resolve(__dirname, '../_locales');

function readCatalog(locale: string): MessageCatalog {
  const filePath = path.join(localesRoot, locale, 'messages.json');
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed),
    `${locale}: messages.json must contain an object`);
  return parsed as MessageCatalog;
}

function validateCatalogShape(locale: string, catalog: MessageCatalog): void {
  for (const [key, entry] of Object.entries(catalog)) {
    assert.ok(entry && typeof entry === 'object' && !Array.isArray(entry),
      `${locale}.${key}: message entry must be an object`);
    assert.equal(typeof entry.message, 'string',
      `${locale}.${key}: message must be a string`);
    assert.ok(entry.message.length > 0, `${locale}.${key}: message must not be empty`);

    if (entry.placeholders === undefined) continue;
    assert.ok(entry.placeholders && typeof entry.placeholders === 'object'
      && !Array.isArray(entry.placeholders),
    `${locale}.${key}: placeholders must be an object`);
    for (const [name, placeholder] of Object.entries(entry.placeholders)) {
      assert.ok(placeholder && typeof placeholder === 'object' && !Array.isArray(placeholder),
        `${locale}.${key}.${name}: placeholder must be an object`);
      assert.equal(typeof placeholder.content, 'string',
        `${locale}.${key}.${name}: placeholder content must be a string`);
      assert.ok(placeholder.content.length > 0,
        `${locale}.${key}.${name}: placeholder content must not be empty`);
    }
  }
}

function placeholderSignature(entry: MessageEntry): string[] {
  return Object.entries(entry.placeholders ?? {})
    .map(([name, placeholder]) => `${name}:${placeholder.content}`)
    .sort();
}

describe('locale catalogs', () => {
  const locales = readdirSync(localesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const canonical = readCatalog('en');
  const canonicalKeys = Object.keys(canonical).sort();

  it('lists every bundled locale exactly once in the language menu', () => {
    assert.deepEqual(LANGUAGES.map(({ locale }) => locale).sort(), locales);
  });

  it('keeps language setting fallbacks identical to English', () => {
    for (const key of ['languageTitle', 'languageDescription', 'languageAutomatic']) {
      assert.equal(FALLBACK_MESSAGES[key], canonical[key].message);
    }
  });

  it('keeps the update notice fallbacks identical to English', () => {
    const english = (key: string) => canonical[key].message.replace('$VERSION$', '$1');
    for (const key of ['updatePanelTitle', 'updateSeeWhatsNew']) assert.equal(FALLBACK_MESSAGES[key], english(key), key);
    assert.equal(PLAYER_I18N_FALLBACKS.updateMenuLabel, english('updateMenuLabel'));
  });

  it('uses valid message structures', () => {
    for (const locale of locales) validateCatalogShape(locale, readCatalog(locale));
  });

  it('keeps accessibility names aligned with the English fallbacks', () => {
    for (const key of ['addExclusion', 'playbackPosition', 'volumeLabel', 'playbackSpeed']) {
      assert.equal(FALLBACK_MESSAGES[key], canonical[key].message, key);
      if (key !== 'addExclusion') assert.equal(PLAYER_I18N_FALLBACKS[key], canonical[key].message, key);
    }
  });

  it('leaves key caps to the caller, which renders one cap per key', () => {
    for (const locale of locales) {
      for (const [key, { message }] of Object.entries(readCatalog(locale))) assert.doesNotMatch(message, /<kbd>/, `${locale}.${key}`);
    }
    for (const [key, message] of [...Object.entries(FALLBACK_MESSAGES), ...Object.entries(PLAYER_I18N_FALLBACKS)]) assert.doesNotMatch(message, /<kbd>/, key);
  });

  it('keeps spoken key names aligned with the English fallbacks', () => {
    for (const [key, message] of Object.entries(KEY_LABEL_FALLBACKS)) assert.equal(canonical[key]?.message, message, key);
  });

  it('keeps every locale in exact key parity with English', () => {
    for (const locale of locales) {
      assert.deepEqual(Object.keys(readCatalog(locale)).sort(), canonicalKeys,
        `${locale}: message keys differ from English`);
    }
  });

  it('keeps placeholder names and substitutions aligned with English', () => {
    for (const locale of locales) {
      const catalog = readCatalog(locale);
      for (const key of canonicalKeys) {
        assert.deepEqual(placeholderSignature(catalog[key]), placeholderSignature(canonical[key]),
          `${locale}.${key}: placeholders differ from English`);
      }
    }
  });

  it('keeps AutoTheater countdown copy free of hard-coded durations', () => {
    // The countdown length is a code constant; copy must not repeat it.
    const seconds = /\d\s*-?\s*(?:s\b|sec|sek|second|seconde|secondi|segundo|секунд|秒|초|ثوان|ثانية)/i;
    for (const locale of locales) {
      const catalog = readCatalog(locale);
      for (const key of Object.keys(catalog).filter((name) => /^autoTheater/.test(name))) {
        assert.doesNotMatch(catalog[key].message, seconds, `${locale}.${key}: hard-codes a duration`);
      }
    }
  });
});
