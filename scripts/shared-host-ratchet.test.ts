import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { describe, it } from 'node:test';

import { repoWithBase } from './ratchet-base-fixture';
import { detect, inventory, scopeOf, servicesInWords, wordsOf, type Inventory } from './shared-host-detector';
import { assertNoGrowth, baselineFile, compareInventory, flattenInventory, readBaseline } from './shared-host-ratchet';
import { assertBaselineRatchet } from './test-determinism';

const hits = (source: string, path = 'src/media-features/x.ts') => detect(path, source).map(hit => `${hit.service}:${hit.kind}`).sort();

describe('service names in identifiers', () => {
  it('splits camelCase, snake_case and acronyms into words', () => {
    assert.deepEqual(wordsOf('isYouTubeHost'), ['is', 'you', 'tube', 'host']);
    assert.deepEqual(wordsOf('TWITCH_CHAT_SELECTOR'), ['twitch', 'chat', 'selector']);
    assert.deepEqual(wordsOf('bilibili-intl'), ['bilibili', 'intl']);
  });

  it('matches whole words only, so look-alikes are not services', () => {
    assert.deepEqual(servicesInWords(wordsOf('Vikings')), []);
    assert.deepEqual(servicesInWords(wordsOf('reviewVikingShip')), []);
    assert.deepEqual(servicesInWords(wordsOf('soopy')), []);
    assert.deepEqual(servicesInWords(wordsOf('twitchy')), []);
    assert.deepEqual(servicesInWords(wordsOf('readNetflixOrDisney')), ['netflix', 'disney']);
  });

  it('keeps Bilibili International apart from Bilibili', () => {
    assert.deepEqual(servicesInWords(wordsOf('readBilibiliIntlControls')), ['bilibiliIntl']);
    assert.deepEqual(servicesInWords(wordsOf('BILIBILI_INTL_SELECTOR')), ['bilibiliIntl']);
    assert.deepEqual(servicesInWords(wordsOf('readBilibiliControls')), ['bilibili']);
  });
});

describe('what counts as host knowledge in shared code', () => {
  it('counts host checks, whether called, imported, aliased or declared', () => {
    assert.deepEqual(hits('if (isNetflixHost()) run();'), ['netflix:hostCheck']);
    assert.deepEqual(hits("import { isTwitchHost } from '../providers/hosts';"), ['twitch:hostCheck']);
    // Aliasing the import does not hide it: the specifier still names the check.
    assert.deepEqual(hits("import { isDisneyHost as onHost } from './hosts';"), ['disney:hostCheck']);
    assert.deepEqual(hits('export const isVikiHost = () => false;'), ['viki:hostCheck']);
  });

  it('counts service identifiers: selector constants, types, branches and keys', () => {
    assert.deepEqual(hits("const TWITCH_CHAT_SELECTOR = '.chat';"), ['twitch:identifier']);
    assert.deepEqual(hits('let session: NetflixSession;'), ['netflix:identifier']);
    assert.deepEqual(hits('const table = { crunchyroll: 1 };'), ['crunchyroll:identifier']);
  });

  it('counts service ids used as values or in unions', () => {
    assert.deepEqual(hits("if (provider === 'twitch') go();"), ['twitch:serviceId']);
    assert.deepEqual(hits("type Chat = 'youtube' | 'soop';"), ['soop:serviceId', 'youtube:serviceId']);
    assert.deepEqual(hits("switch (id) { case 'bilibili-intl': break; }"), ['bilibiliIntl:serviceId']);
    assert.deepEqual(hits('const id = `iqiyi`;'), ['iqiyi:serviceId']);
  });

  it('counts domains in strings, templates and regular expressions, subdomains and CDNs included', () => {
    assert.deepEqual(hits("const url = 'https://www.netflix.com/watch';"), ['netflix:domain']);
    assert.deepEqual(hits('const url = `https://${region}.disneyplus.com/x`;'), ['disney:domain']);
    assert.deepEqual(hits('const re = /^https:\\/\\/(?:www\\.)?vimeo\\.com\\//;'), ['vimeo:domain']);
    assert.deepEqual(hits('const re = /static-cdn\\.jtvnw\\.net/;'), ['twitch:domain']);
    assert.deepEqual(hits("host.endsWith('.bstarstatic.com');"), ['bilibiliIntl:domain']);
    assert.deepEqual(hits("const player = 'play.wetv.vip';"), ['tencent:domain']);
  });

  it('counts a service-named file whatever it contains', () => {
    assert.deepEqual(hits('export {};', 'src/media-features/parsers/netflix-page.ts'), ['netflix:file']);
    assert.deepEqual(hits('export {};', 'src/providers/navigation/bilibili-intl.ts'), ['bilibiliIntl:file']);
  });
});

describe('what does not count', () => {
  it('ignores comments, prose and look-alike strings', () => {
    assert.deepEqual(hits('// Netflix and Twitch quirks\n/** isYouTubeHost, netflix.com */\nconst a = 1;'), []);
    assert.deepEqual(hits("const label = 'Watch on Netflix';"), []);
    assert.deepEqual(hits("const a = 'notnetflix.com';"), []);
    assert.deepEqual(hits("const b = 'not-twitch.tv';"), []);
    assert.deepEqual(hits("const v = 'viking';"), []);
  });

  it('ignores module specifiers; the identifiers they bind are what count', () => {
    assert.deepEqual(hits("import './netflix.com';"), []);
    assert.deepEqual(hits("export * from './vimeo';"), []);
  });

  it('keeps the host-free generic code at zero', () => {
    assert.deepEqual(hits("export function isEditableTarget(el: Element) { return el.matches('input, textarea'); }"), []);
  });
});

describe('scope', () => {
  it('covers shared directories and the shared parts of providers', () => {
    assert.equal(scopeOf('src/ui/chat.ts'), 'src/ui');
    assert.equal(scopeOf('src/chat/controller.ts'), 'src/chat');
    assert.equal(scopeOf('src/providers/registry.ts'), 'src/providers');
    assert.equal(scopeOf('src/providers/navigation/netflix.ts'), 'src/providers/navigation');
    assert.equal(scopeOf('src/providers/native/page-title.ts'), 'src/providers/native');
  });

  it('leaves provider-owned directories, tests, test utilities and generated code out', () => {
    assert.equal(scopeOf('src/providers/netflix/main.ts'), null);
    assert.equal(scopeOf('src/providers/bilibili-intl/adapter.ts'), null);
    assert.equal(scopeOf('src/providers/youtube/isolated.ts'), null);
    assert.equal(scopeOf('src/ui/chat.test.ts'), null);
    assert.equal(scopeOf('src/ui/chat.browser.test.ts'), null);
    assert.equal(scopeOf('src/ui/chat.stories.ts'), null);
    assert.equal(scopeOf('src/test-utils/boot.ts'), null);
    assert.equal(scopeOf('src/i18n.ts'), null);
    assert.equal(scopeOf('src/ui/theme.css'), null);
  });

  it('counts per service and per directory', () => {
    const result = inventory([
      { path: 'src/ui/a.ts', source: 'isNetflixHost(); isNetflixHost();' },
      { path: 'src/core/b.ts', source: "const x = 'twitch';" },
      { path: 'src/providers/netflix/main.ts', source: 'isNetflixHost();' },
      { path: 'src/ui/a.test.ts', source: 'isNetflixHost();' },
    ]);
    assert.deepEqual(result, { netflix: { 'src/ui': { hostCheck: 2 } }, twitch: { 'src/core': { serviceId: 1 } } });
  });
});

describe('the ratchet', () => {
  const baseline: Inventory = { netflix: { 'src/ui': { hostCheck: 2, identifier: 3 } }, twitch: { 'src/chat': { identifier: 5 } } };

  it('passes unchanged', () => {
    assertNoGrowth(baseline, baseline);
  });

  it('fails when a cell grows', () => {
    const grown: Inventory = { ...baseline, netflix: { 'src/ui': { hostCheck: 3, identifier: 3 } } };
    assert.throws(() => assertNoGrowth(grown, baseline), /netflix src\/ui hostCheck grew from 2 to 3/);
  });

  it('fails when a service gains a kind or a directory, including by moving code', () => {
    const newKind: Inventory = { ...baseline, twitch: { 'src/chat': { identifier: 5, domain: 1 } } };
    assert.throws(() => assertNoGrowth(newKind, baseline), /twitch src\/chat domain grew from 0 to 1/);
    // Moving a reference out of src/ui into src/core drops one cell and grows another.
    const moved: Inventory = { ...baseline, netflix: { 'src/ui': { hostCheck: 1, identifier: 3 }, 'src/core': { hostCheck: 1 } } };
    assert.throws(() => assertNoGrowth(moved, baseline), /netflix src\/core hostCheck grew from 0 to 1/);
    const newService: Inventory = { ...baseline, vimeo: { 'src/ui': { identifier: 1 } } };
    assert.throws(() => assertNoGrowth(newService, baseline), /vimeo src\/ui identifier grew/);
  });

  it('requires an improvement to be locked in, and allows it with --update', () => {
    const better: Inventory = { netflix: { 'src/ui': { hostCheck: 1, identifier: 3 } }, twitch: { 'src/chat': { identifier: 5 } } };
    assert.throws(() => assertNoGrowth(better, baseline), /netflix src\/ui hostCheck dropped from 2 to 1[\s\S]*--update/);
    assertNoGrowth(better, baseline, { allowImprovement: true });
    assert.deepEqual(compareInventory({}, baseline).grown, []);
  });

  it('still rejects growth next to an improvement when updating', () => {
    const mixed: Inventory = { netflix: { 'src/ui': { hostCheck: 1, identifier: 4 } }, twitch: { 'src/chat': { identifier: 5 } } };
    assert.throws(() => assertNoGrowth(mixed, baseline, { allowImprovement: true }), /identifier grew from 3 to 4/);
  });

  it('validates the recorded baseline', () => {
    assert.throws(() => readBaseline('{"netflix":{"src/ui":{"hostCheck":0}}}'), /positive integers/);
    assert.throws(() => readBaseline('{"hulu":{"src/ui":{"hostCheck":1}}}'), /unknown service/);
    assert.throws(() => readBaseline('{"netflix":{"src/ui":{"guess":1}}}'), /unknown kind/);
    assert.deepEqual(readBaseline('{"netflix":{"src/ui":{"hostCheck":1}}}'), { netflix: { 'src/ui': { hostCheck: 1 } } });
  });

  it('keeps the recorded baseline readable', () => {
    assert.doesNotThrow(() => readBaseline(readFileSync('config/shared-host-baseline.json', 'utf8')));
  });
});

describe('the base branch comparison', () => {
  const base: Inventory = { netflix: { 'src/ui': { hostCheck: 2 } } };
  const raised: Inventory = { netflix: { 'src/ui': { hostCheck: 3 } } };

  it('rejects a tree that grew past the base even when the baseline was raised to match', () => {
    const directory = repoWithBase(baselineFile.path, JSON.stringify(base), JSON.stringify(raised));
    try {
      // The branch's own baseline says 3 and the tree has 3, so only the base reveals the growth.
      assertNoGrowth(raised, raised);
      assert.throws(() => assertBaselineRatchet(flattenInventory(raised), directory, true, baselineFile), /netflix src\/ui: hostCheck grew from 2 to 3; move the host knowledge into its provider/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('accepts an unchanged or lowered tree, and a first introduction', () => {
    const directory = repoWithBase(baselineFile.path, JSON.stringify(base), JSON.stringify(base));
    try {
      assertBaselineRatchet(flattenInventory(base), directory, true, baselineFile);
      assertBaselineRatchet(flattenInventory({ netflix: { 'src/ui': { hostCheck: 1 } } }), directory, true, baselineFile);
      assertBaselineRatchet(flattenInventory(raised), directory, true, { ...baselineFile, path: 'config/not-in-base.json' });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

it('excludes the validated generated catalog but still counts handwritten catalog consumers', () => {
  assert.equal(scopeOf('src/providers/catalog.ts'), null);
  const found = inventory([{ path: 'src/providers/catalog-reader.ts', source: "const endpoint = 'https://api.viki.io/';" }]);
  assert.equal(found.viki['src/providers'].domain, 1);
});
