import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { CHROME_LIMITS } from './print-store-listing';

const listingsRoot = path.resolve(__dirname, '../store-listings');
const chromeRoot = path.join(listingsRoot, 'chrome');
const amoRoot = path.join(listingsRoot, 'amo');
const extensionLocalesRoot = path.resolve(__dirname, '../_locales');

// Chrome Web Store rejects descriptions that read as keyword spam, so every
// language names exactly these four supported services (YouTube in all packs),
// picked for regional relevance, and no other supported-service brand.
const SERVICE_PACKS: Record<string, string[]> = {
  en: ['YouTube', 'Twitch', 'Netflix', 'Disney+'],
  en_GB: ['YouTube', 'Twitch', 'Netflix', 'Disney+'],
  cs: ['YouTube', 'Twitch', 'Netflix', 'Disney+'],
  sk: ['YouTube', 'Twitch', 'Netflix', 'Disney+'],
  de: ['YouTube', 'Twitch', 'Netflix', 'Disney+'],
  pl: ['YouTube', 'Twitch', 'Netflix', 'Disney+'],
  ko: ['YouTube', 'Netflix', 'Disney+', 'Crunchyroll'],
  ja: ['YouTube', 'Netflix', 'Disney+', 'Crunchyroll'],
  fr: ['YouTube', 'Netflix', 'Disney+', 'Crunchyroll'],
  es: ['YouTube', 'Netflix', 'Disney+', 'Crunchyroll'],
  it: ['YouTube', 'Netflix', 'Disney+', 'Crunchyroll'],
  pt_BR: ['YouTube', 'Netflix', 'Disney+', 'Crunchyroll'],
  ru: ['YouTube', 'Twitch', 'Vimeo', 'Crunchyroll'],
  uk: ['YouTube', 'Twitch', 'Netflix', 'Crunchyroll'],
  zh_CN: ['YouTube', 'Twitch', 'Bilibili', '腾讯视频'],
  ar: ['YouTube', 'Netflix', 'Twitch', 'Disney+']
};

// Every supported-service brand with its transliterations, normalized to the
// name used in SERVICE_PACKS. WeTV is detected on its own and belongs to no pack.
// Bilibili.tv is a separate service from Bilibili; the Bilibili pattern skips it.
const SERVICE_BRANDS: Array<[brand: string, pattern: RegExp]> = [
  ['YouTube', /YouTube|يوتيوب|ユーチューブ|유튜브|Ютуб|Ютюб/i],
  ['Twitch', /Twitch|تويتش|ツイッチ|트위치|Твитч|Твіч/i],
  ['Netflix', /Netflix|نتفليكس|ネットフリックス|넷플릭스|Нетфликс|Нетфлікс/i],
  ['Disney+', /Disney|ديزني|ディズニー|디즈니|Дисней|Дісней/i],
  ['Crunchyroll', /Crunchyroll|كرانشي ?رول|クランチロール|크런치롤|Кранчиролл|Кранчіролл/i],
  ['Vimeo', /Vimeo|فيميو|ビメオ|비메오|Вимео|Вімео/i],
  ['Patreon', /Patreon|باتريون|パトレオン|패트리온|Патреон/i],
  ['Bilibili', /Bilibili(?!\.tv)|بيلي ?بيلي|ビリビリ|빌리빌리|Билибили|Білібілі|哔哩哔哩/i],
  ['Bilibili.tv', /Bilibili\.tv/i],
  ['腾讯视频', /腾讯|Tencent|腾訊/i],
  ['WeTV', /WeTV/i],
  ['SOOP', /\bSOOP\b/i],
  ['iQIYI', /iQIYI|爱奇艺/i],
  ['Rakuten Viki', /\bViki\b/i]
];

// AMO allows at most 10 tags, chosen from its fixed list.
const AMO_MAX_TAGS = 10;

function brandsIn(text: string): string[] {
  return SERVICE_BRANDS.filter(([, pattern]) => pattern.test(text)).map(([brand]) => brand);
}

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

// The AMO description is the Chrome text with one contiguous block of lines
// replaced (the "full list is in Settings" line by the "Also supported:" block).
// Everything before and after the block must be identical, line for line.
function replacedBlock(chromeLong: string, amoDescription: string) {
  const chrome = chromeLong.trim().split('\n');
  const amo = amoDescription.trim().split('\n');
  let head = 0;
  while (head < chrome.length && head < amo.length && chrome[head] === amo[head]) head += 1;
  let tail = 0;
  while (tail < chrome.length - head && tail < amo.length - head
    && chrome[chrome.length - 1 - tail] === amo[amo.length - 1 - tail]) tail += 1;
  return {
    before: chrome.slice(0, head),
    chrome: chrome.slice(head, chrome.length - tail),
    amo: amo.slice(head, amo.length - tail),
    after: chrome.slice(chrome.length - tail)
  };
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

  it('keeps the AMO name and summary aligned with the locale messages', () => {
    for (const locale of locales) {
      const messages = readCatalog(locale);
      const amo = readAmo(locale);
      assert.equal(amoSection(amo, 'Name'), messages.extensionNameCompact?.message,
        `${locale}: AMO name differs from extensionNameCompact`);
      assert.equal(amoSection(amo, 'Summary'), messages.extensionDescription?.message, `${locale}: summary differs`);
    }
  });

  it('builds the AMO description from the Chrome text by replacing only the services line', () => {
    for (const locale of locales) {
      const block = replacedBlock(readChromeLong(locale), amoSection(readAmo(locale), 'Description'));
      assert.equal(block.chrome.length, 1, `${locale}: AMO must replace exactly one Chrome line`);
      assert.ok(block.chrome[0] && !block.chrome[0].startsWith('- '), `${locale}: the replaced Chrome line must be the pointer to Settings`);
      assert.ok(block.amo.length >= 2, `${locale}: the AMO block needs a label and service lines`);
      assert.ok(block.amo.every((line) => line.trim()), `${locale}: the AMO block must not contain blank lines`);
      assert.ok(!block.amo[0]!.startsWith('- '), `${locale}: the AMO block must open with the "Also supported:" label line`);
      assert.ok(block.amo.slice(1).every((line) => line.startsWith('- ')), `${locale}: every AMO block line after the label must be a "- " service line`);
      assert.ok(block.before.at(-1)?.startsWith('- '), `${locale}: the AMO block must follow the pack's service lines`);
      assert.equal(block.after[0], '', `${locale}: the AMO block must end right before the blank line preceding the next section`);
    }
  });

  it('names every supported service in the AMO description', () => {
    for (const locale of locales) {
      const { amo } = replacedBlock(readChromeLong(locale), amoSection(readAmo(locale), 'Description'));
      const named = new Set([...SERVICE_PACKS[locale]!, ...brandsIn(amo.join('\n'))]);
      const missing = SERVICE_BRANDS.map(([brand]) => brand).filter((brand) => !named.has(brand));
      assert.deepEqual(missing, [], `${locale}: AMO description does not name ${missing.join(', ')}`);
    }
  });

  it('suggests at most 10 non-empty AMO tags', () => {
    for (const locale of locales) {
      const tags = amoSection(readAmo(locale), 'Suggested tags').split(',').map((tag) => tag.trim());
      assert.ok(tags.every(Boolean), `${locale}: empty AMO tag`);
      assert.ok(tags.length <= AMO_MAX_TAGS, `${locale}: ${tags.length} AMO tags, the limit is ${AMO_MAX_TAGS}`);
    }
  });

  it('names exactly the regional pack of four services in every Chrome description', () => {
    assert.deepEqual(Object.keys(SERVICE_PACKS).sort(), locales);
    assert.equal(locales.length, 16);
    for (const [locale, pack] of Object.entries(SERVICE_PACKS)) {
      assert.equal(new Set(pack).size, 4, `${locale}: pack must hold exactly 4 unique services`);
      assert.ok(pack.includes('YouTube'), `${locale}: pack must include YouTube`);
      assert.ok(!pack.includes('WeTV'), `${locale}: WeTV belongs to no pack`);
    }
    for (const locale of locales) {
      const text = readChromeLong(locale);
      assert.deepEqual(brandsIn(text).sort(), [...SERVICE_PACKS[locale]].sort(), `${locale}: service names differ from the pack`);
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
