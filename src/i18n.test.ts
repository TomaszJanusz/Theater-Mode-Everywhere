import assert from 'node:assert/strict';
import { it } from 'node:test';
import { DEFAULT_LANGUAGE, LANGUAGES, resolveLanguage, type Locale } from './language';
import { createLanguageRuntime, languageRuntime, translateMessage } from './i18n-runtime';
import { compileCatalog, isMessageCatalog, substituteMessage, type MessageCatalog } from './message-catalog';
import { t as settingsMessage } from './i18n';
import { t as playerMessage } from './ui/messages';
import { loadLanguageCatalog } from './platform/locale-catalog';

it('resolves only supported saved language identifiers; invalid values follow the browser', () => {
  for (const { locale } of LANGUAGES) assert.equal(resolveLanguage(locale), locale);
  for (const value of [undefined, null, false, {}, [], '', 'automatic', 'en-US', 'pt-BR', 'EN', '../en', 'unknown']) {
    assert.equal(resolveLanguage(value), DEFAULT_LANGUAGE);
  }
});

it('expands case-insensitive named placeholders before single-pass positional substitutions', () => {
  const catalog = compileCatalog({ greeting: {
    message: '$USER$ / $user$ / $SITE$ / $2 / $9 / $$ / $$$ / $$1',
    placeholders: { user: { content: '$1' }, site: { content: 'example.test/$2' } }
  } });
  const message = catalog.get('greeting')!;
  assert.equal(substituteMessage(message, ['Alice $2', 'two']),
    'Alice $2 / Alice $2 / example.test/two / two /  / $ / $$ / $1');
  assert.equal(substituteMessage('$1 $2 $1', 'one'), 'one  one');
  assert.equal(substituteMessage('$1/$9'), '/');
  assert.equal(substituteMessage('$9 $10', ['1','2','3','4','5','6','7','8','9']), '9 10');
  assert.equal(substituteMessage('$1', Array(10).fill('x')), '');
});

it('validates messages received across the runtime boundary', () => {
  for (const value of [null, [], 'x', { a: null }, { a: { message: 3 } }, { a: { message: 'x', placeholders: { p: {} } } }]) {
    assert.equal(isMessageCatalog(value), false);
  }
  assert.equal(isMessageCatalog({ a: { message: '$P$', placeholders: { p: { content: '$1' } } } }), true);
});

it('Automatic loads no catalogs and keeps the native getMessage path', async () => {
  const runtime = createLanguageRuntime(async () => { throw new Error('must not load'); });
  await runtime.set(undefined);
  await runtime.set('unknown');
  assert.equal(runtime.overridden, false);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { i18n: {
    getMessage: (key: string, values?: string | string[]) => `${key}:${values}`
  } } });
  try { assert.equal(translateMessage({}, 'native', 'test'), 'native:test'); }
  finally {
    if (original) Object.defineProperty(globalThis, 'chrome', original);
    else Reflect.deleteProperty(globalThis, 'chrome');
  }
});

it('keeps shared and surface-specific English fallbacks when native i18n is unavailable', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  try {
    for (const chrome of [undefined, { i18n: { getMessage: () => '' } }, {
      i18n: { getMessage: () => { throw new Error('Extension context invalidated'); } }
    }]) {
      Object.defineProperty(globalThis, 'chrome', { configurable: true, value: chrome });
      for (const t of [settingsMessage, playerMessage]) {
        assert.equal(t('shortcutConflictDescription', ['K', 'Play', 'Mute']),
          'K is assigned to Play. Move it to Mute? The previous actions will no longer have this shortcut.');
        assert.equal(t('missingKey'), 'missingKey');
      }
      assert.equal(settingsMessage('languageAutomatic'), 'Automatic (browser language)');
      assert.equal(playerMessage('autoEnterNoticeHint', 'K'), 'Click or press K to cancel');
      assert.equal(playerMessage('languageAutomatic'), 'languageAutomatic');
      assert.equal(settingsMessage('autoEnterNoticeHint'), 'autoEnterNoticeHint');
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'chrome', original);
    else Reflect.deleteProperty(globalThis, 'chrome');
  }
});

it('loads only allowlisted packaged resources and falls back to English, never the browser language', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  const originalFetch = globalThis.fetch;
  const paths: string[] = [];
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: { getURL: (p: string) => p } } });
  globalThis.fetch = async input => {
    paths.push(String(input));
    return new Response(JSON.stringify(String(input).includes('/en/')
      ? { englishOnly: { message: 'English $1' }, shared: { message: 'English' } }
      : { shared: { message: 'Polski' } }));
  };
  try {
    const runtime = createLanguageRuntime(loadLanguageCatalog);
    await runtime.set('pl');
    assert.equal(runtime.message('SHARED'), 'Polski');
    assert.equal(runtime.message('englishOnly', 'fallback'), 'English fallback');
    assert.equal(runtime.message('unknown'), undefined);
    assert.deepEqual(paths, ['_locales/en/messages.json', '_locales/pl/messages.json']);
    await assert.rejects(loadLanguageCatalog('../en'));
    assert.equal(paths.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (original) Object.defineProperty(globalThis, 'chrome', original);
    else Reflect.deleteProperty(globalThis, 'chrome');
  }
});

function deferredCatalogs() {
  const loads = new Map<Locale, (catalog: MessageCatalog) => void>();
  const runtime = createLanguageRuntime(locale => new Promise(resolve => loads.set(locale, resolve)));
  return { runtime, resolve: (locale: Locale, message = locale) => loads.get(locale)!({ label: { message } }) };
}

it('publishes a complete locale atomically and rejects stale loads, including after Automatic', async () => {
  const { runtime, resolve } = deferredCatalogs();
  const paints: Array<Array<string | undefined>> = [];
  runtime.subscribe(() => paints.push([runtime.language, runtime.message('label'), runtime.message('@@bidi_dir')]));
  const old = runtime.set('pl');
  const latest = runtime.set('ar');
  assert.equal(runtime.overridden, false, 'loading must retain the previous complete snapshot');
  resolve('ar');
  await latest;
  assert.deepEqual(paints, [['ar', 'ar', 'rtl']]);
  resolve('pl');
  await old;
  assert.equal(runtime.message('label'), 'ar');
  const stale = runtime.set('de');
  await runtime.set('automatic');
  resolve('de');
  await stale;
  assert.equal(runtime.overridden, false);
  assert.equal(runtime.message('@@bidi_dir'), 'ltr');
  assert.equal(paints.length, 2);
});

it('a storage read started before a language change cannot restore an old choice', async () => {
  const { runtime, resolve } = deferredCatalogs();
  const readRevision = runtime.revision;
  const selected = runtime.set('pl');
  const initialRead = runtime.set('ar', readRevision);
  resolve('pl');
  await Promise.all([selected, initialRead]);
  assert.equal(runtime.language, 'pl');
  assert.equal(runtime.message('@@ui_locale'), 'pl');
  assert.equal(runtime.message('@@bidi_dir'), 'ltr');
});

it('deduplicates pending loads and supports subscriptions replaced during a UI rebuild', async () => {
  const { runtime, resolve } = deferredCatalogs();
  let paints = 0;
  const stop = runtime.subscribe(() => {
    paints++;
    stop();
    runtime.subscribe(() => { paints++; });
  });
  const first = runtime.set('pl');
  assert.equal(runtime.set('pl'), first);
  resolve('pl');
  await first;
  assert.equal(paints, 1, 'newly mounted subscribers must wait for the next publication');
  await runtime.set('automatic');
  assert.equal(paints, 2);
});

it('a failed obsolete load cannot reset a newer locale', async () => {
  let rejectOld!: (error: Error) => void;
  const runtime = createLanguageRuntime(locale => locale === 'pl'
    ? new Promise((_resolve, reject) => { rejectOld = reject; })
    : Promise.resolve({ label: { message: 'new' } }));
  const old = runtime.set('pl');
  await runtime.set('ar');
  rejectOld(new Error('obsolete'));
  await old;
  assert.equal(runtime.language, 'ar');
});

it('an Automatic storage event invalidates an older initial override read even before hydration', async () => {
  let loads = 0;
  const runtime = createLanguageRuntime(async () => { loads++; return {}; });
  const readRevision = runtime.revision;
  await runtime.set('automatic');
  await runtime.set('pl', readRevision);
  assert.equal(loads, 0);
  assert.equal(runtime.language, 'automatic');
});

it('extension pages and player share the same override, preserve empty substitutions and return unknown keys', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
    sendMessage: async () => ({ placeholders: { message: '$1' },
      named: { message: '$USER$', placeholders: { user: { content: '$1' } } } })
  } } });
  try {
    await languageRuntime.set('ar');
    for (const t of [settingsMessage, playerMessage]) {
      assert.equal(t('named', 'نص'), 'نص');
      assert.equal(t('placeholders'), '');
      assert.equal(t('missingKey'), 'missingKey');
      assert.equal(t('@@ui_locale'), 'ar');
      assert.equal(t('@@bidi_dir'), 'rtl');
      assert.equal(t('@@UI_LOCALE'), 'ar');
      assert.equal(t('@@BIDI_DIR'), 'rtl');
    }
    await languageRuntime.set('automatic');
    assert.equal(settingsMessage('@@bidi_dir'), 'ltr');
    assert.equal(playerMessage('@@ui_locale'), 'en');
  } finally {
    await languageRuntime.set('automatic');
    if (original) Object.defineProperty(globalThis, 'chrome', original);
    else Reflect.deleteProperty(globalThis, 'chrome');
  }
});
