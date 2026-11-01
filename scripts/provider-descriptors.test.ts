import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';

import { PROVIDER_CATALOG } from '../src/providers/catalog';
import { descriptorMatchesHost } from '../src/providers/descriptor-hosts';
import type { ProviderRuntimeApi } from '../src/providers/provider-api';
import { PROVIDER_DEFINITIONS } from '../src/providers/registry';
import { createProviderRegistry } from '../src/providers/runtime-registration';
import { bundleQueryModules } from '../src/test-utils/query-bundle';

import { assertProviderSources, catalogSource, classicEntries, contentScripts, discoverDescriptors, isHostOnlySource, parseDescriptor, providerMatches } from './provider-descriptors';

const root = path.resolve(__dirname, '..');
const descriptors = discoverDescriptors(root);

it('keeps descriptors, source manifest, catalog, registry and entry inventory consistent', () => {
  assertProviderSources(root, descriptors);
  assert.deepEqual(PROVIDER_CATALOG, descriptors.map(({ id, hosts, home, mediaFetch }) => ({ id, hosts, ...(home ? { home } : {}), ...(mediaFetch ? { mediaFetch } : {}) })));
  for (const descriptor of descriptors) {
    assert.equal(PROVIDER_DEFINITIONS.filter(item => item.id === descriptor.id).length, 1);
    for (const host of descriptor.hosts) {
      const definition = PROVIDER_DEFINITIONS.find(item => item.id === descriptor.id)!;
      for (const sample of [host.domain, `sub.${host.domain}`, `${host.domain}.`, `${host.domain}.evil.test`, `not${host.domain}`]) {
        assert.equal(definition.matchesHost(sample), descriptorMatchesHost(descriptor.hosts, sample), sample);
      }
    }
  }
  const outputs = classicEntries(descriptors).map(entry => `${entry.output}.js`).sort();
  assert.deepEqual([...new Set(contentScripts(descriptors).flatMap(rule => rule.js))].sort(), outputs);
});

it('fails on stale manifests or catalogs and unsafe/missing descriptor entries', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'tme-184-descriptors-'));
  try {
    mkdirSync(path.join(directory, 'src/providers/soop'), { recursive: true });
    writeFileSync(path.join(directory, 'src/providers/catalog.ts'), catalogSource(descriptors));
    const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    manifest.content_scripts[0].js.reverse();
    writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    assert.throws(() => assertProviderSources(directory, descriptors), /manifest drift/);
    writeFileSync(path.join(directory, 'src/providers/catalog.ts'), 'stale');
    assert.throws(() => assertProviderSources(directory, descriptors), /catalog drift/);
    const value = JSON.parse(readFileSync(path.join(root, 'src/providers/soop/provider.json'), 'utf8'));
    for (const mutation of [
      { ...value, schemaVersion: 2 }, { ...value, id: 'unknown' },
      { ...value, hosts: [{ domain: 'sooplive.com/*', includeSubdomains: true }] },
      { ...value, entries: { ...value.entries, main: { file: '../other.ts', runAt: 'document_start' } } },
      { ...value, entries: { ...value.entries, main: { file: 'main.ts', runAt: 'document_idle' } } }
    ]) assert.throws(() => parseDescriptor(mutation));
    writeFileSync(path.join(directory, 'src/providers/soop/provider.json'), JSON.stringify(value));
    assert.throws(() => discoverDescriptors(directory), /Missing entry/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it('uses disjoint rules, private ordered scripts, and both dotted DNS spellings', () => {
  const rules = contentScripts(descriptors);
  for (const descriptor of descriptors) {
    const matches = providerMatches(descriptor);
    for (const host of descriptor.hosts) for (const dot of ['', '.']) assert.ok(matches.includes(`*://${host.includeSubdomains ? '*.' : ''}${host.domain}${dot}/*`));
    for (const world of ['isolated', 'main'] as const) {
      const script = `providers/${descriptor.id}/${world}.js`;
      const rule = rules.find(rule => rule.js.includes(script))!;
      assert.deepEqual(rule.matches, matches);
      assert.equal(rule.js.indexOf(script), 1);
      assert.equal(rule.run_at, 'document_start');
      assert.equal(rule.all_frames, true);
      const fallback = rules.find(rule => rule.matches.includes('<all_urls>') && rule.js[0] === (world === 'main' ? 'mainWorld.js' : 'content.js'))!;
      assert.deepEqual(fallback.exclude_matches, descriptors.flatMap(providerMatches));
    }
  }
});

it('each descriptor entry actually registers its own hooks in its own world before startup', async () => {
  const chatWorlds = new Map<string, number>();
  for (const descriptor of descriptors) for (const world of ['isolated', 'main'] as const) {
    const registry = createProviderRegistry(descriptor.hosts[0].domain);
    const services = world === 'main' ? { fetchPageMedia: async () => null, navigationObserver: () => ({ subscribe: () => () => {}, check() {} }) } : { requestPageFetch: async () => null, requestMediaProbe: async () => ({}), requestProviderProbe: async () => null, serviceElementToken: () => 1,
      observeProviderDom: () => () => {}, parseCaptionPayload: () => [] };
    const api: ProviderRuntimeApi = { contractVersion: 1, register: registry.register, start() {}, services };
    const window = { location: { hostname: descriptor.hosts[0].domain }, [Symbol.for(`theater-everywhere.provider-runtime.${world}`)]: api };
    const code = await bundleQueryModules([`import './providers/${descriptor.id}/${descriptor.entries[world].file}';`]);
    runInNewContext(code, { window, URL });
    assert.equal(registry.state(descriptor.id), 'ready', `${descriptor.id}/${world} registration mismatch`);
    const hooks = registry.get(descriptor.id)!;
    assert.ok(hooks.watchPlayback);
    // Isolated-only hooks never register in MAIN, and MAIN installation never in the isolated world.
    assert.equal(Boolean(hooks.createAdapter), world === 'isolated');
    for (const name of ['navigation', 'serviceActions', 'launcherPlacement', 'timeline', 'timelineMarkers', 'stage', 'hostCaptions', 'titleFromPage'] as const) assert.ok(world === 'isolated' || !hooks[name], name);
    assert.ok(world === 'main' || !hooks.install);
    chatWorlds.set(descriptor.id, (chatWorlds.get(descriptor.id) ?? 0) + Number(Boolean(hooks.chat)));
    if (descriptor.id === 'soop') assert.equal(hooks.allowsMediaFetch?.({ provider: 'soop', kind: 'chapters', url: 'https://stbbs.sooplive.com/api/chapter/Controllers/ChapterListController.php?nTitleNo=1&szFileType=REVIEW' }), true);
    assert.equal(registry.start(), true);
    assert.equal(registry.start(), false);
    assert.equal(registry.register(hooks), false, 'no late registration can mutate an active session');
  }
  // A chat hook is registered in both worlds or neither: MAIN's entry shortcut capture must leave chat keys alone too.
  for (const [id, worlds] of chatWorlds) assert.notEqual(worlds, 1, `${id} chat`);
  assert.equal(chatWorlds.get('soop'), 2);
});

it('shared bundles have no extracted implementation and providers have no duplicated runtime owners', async () => {
  for (const entry of classicEntries(descriptors)) {
    const inputs = await entryInputs(entry.source);
    if (!entry.output.startsWith('providers/')) {
      for (const descriptor of descriptors) assert.ok(!inputs.some(input => isHostOnlySource(`${root}/${input}`, descriptor)), entry.output);
    } else {
      assert.ok(!inputs.some(input => /(?:runtime-registration|\/registry|media-features\/probe|platform\/harvest-ownership|platform\/page-fetch)\.ts$/.test(input)), entry.output);
    }
  }
});

async function entryInputs(source: string): Promise<string[]> {
  const inputs: string[] = [];
  await bundleQueryModules([`import '../${source}';`], 'GraphTest', [{ name: 'provider-graph', setup(build) {
    build.initialOptions.metafile = true;
    build.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'text' }));
    build.onEnd(result => { inputs.push(...Object.keys(result.metafile?.inputs ?? {})); });
  } }]);
  return inputs;
}

it('admits providers by each document hostname and preserves the generic path elsewhere', async () => {
  const { manifestScriptsForUrl } = await import('./provider-descriptors');
  const manifest = { content_scripts: contentScripts(descriptors) };
  for (const host of ['sooplive.com', 'play.sooplive.com', 'vod.sooplive.com', 'SOOPLIVE.COM', 'play.sooplive.com.']) {
    const files = manifestScriptsForUrl(manifest, `https://${host}/`);
    assert.equal(files.length, 6, host);
    assert.ok(files.includes('providers/soop/isolated.js'), host);
    assert.ok(files.includes('providers/soop/main.js'), host);
  }
  for (const host of ['www.youtube.com', 'm.youtube.com', 'youtube.com.', 'www.youtube-nocookie.com', 'youtu.be', 'YOUTU.BE.']) {
    const files = manifestScriptsForUrl(manifest, `https://${host}/`);
    assert.deepEqual(files, ['mainWorld.js', 'providers/youtube/main.js', 'mainWorldStart.js', 'content.js', 'providers/youtube/isolated.js', 'contentStart.js'], host);
  }
  // youtu.be is exact; spoofed and look-alike hosts keep the generic path.
  for (const host of ['www.youtu.be', 'youtube.com.evil.test', 'notyoutube.com', 'youtube.co', 'vimeo.com.evil.test', 'notvimeo.com', 'example.test', 'sooplive.com.evil.test', 'notsooplive.com', 'sooplive.co.kr', 'afreecatv.com']) {
    assert.deepEqual(manifestScriptsForUrl(manifest, `https://${host}/`), ['mainWorld.js', 'mainWorldStart.js', 'content.js', 'contentStart.js'], host);
  }
});

it('keeps exact descriptor hosts exact while folding case and terminal DNS dots', () => {
  const hosts = [{ domain: 'example.com', includeSubdomains: false }];
  for (const host of ['example.com', 'EXAMPLE.COM', 'example.com.']) assert.equal(descriptorMatchesHost(hosts, host), true);
  for (const host of ['www.example.com', 'sub.example.com', 'example.com.evil.test']) assert.equal(descriptorMatchesHost(hosts, host), false);
});

it('validates and preserves canonical home declarations without changing injection rules', () => {
  // Any descriptor that declares no home yet, so the test does not change as providers adopt one.
  const original = descriptors.find(item => !item.home)!;
  const home = `https://${original.hosts[0].domain}/`;
  const declared = parseDescriptor({ ...original, home });
  assert.equal(declared.home, home);
  assert.ok(catalogSource([declared]).includes(JSON.stringify(home)));
  assert.deepEqual(contentScripts([declared]), contentScripts([original]));
  assert.equal(parseDescriptor(original).home, undefined);
  for (const home of [42, '/relative', 'javascript:alert(1)', 'http://sooplive.com/',
    'https://sooplive.com.evil.test/', 'https://user:pass@sooplive.com/', 'https://sooplive.com:8443/']) {
    assert.throws(() => parseDescriptor({ ...original, home }));
  }
});

it('validates broker URL declarations and carries them into the registry-free catalog', () => {
  const rule = { kind: 'caption-track', host: 'captions.example.test', pathname: '^/tracks/[a-z]+\\.vtt$' };
  const declared = parseDescriptor({ ...descriptors[0], mediaFetch: [rule] });
  assert.deepEqual(declared.mediaFetch, [rule]);
  assert.ok(catalogSource([declared]).includes('captions.example.test'));
  for (const rule of [{ kind: 'license', host: 'example.test', pathname: '^/ok$' },
    { kind: 'caption-track', host: '*.example.test', pathname: '^/ok$' },
    { kind: 'caption-track', host: 'example.test', pathname: '/unanchored' },
    { kind: 'caption-track', host: 'example.test', pathname: '^/[$' }]) {
    assert.throws(() => parseDescriptor({ ...descriptors[0], mediaFetch: [rule] }));
  }
});

it('keeps staged extraction exemptions exact and entry implementation host-only', () => {
  const descriptor = descriptors.find(item => item.id === 'disney')!;
  assert.equal(isHostOnlySource(`${root}/src/providers/disney/main.ts`, descriptor), false);
  for (const name of ['audio-main.ts', 'audio-adapter.ts', 'audio-bridge.ts', 'nested/main.ts']) {
    assert.equal(isHostOnlySource(`${root}/src/providers/disney/${name}`, descriptor), true, name);
  }
  for (const files of [[], [descriptor.entries.isolated.file], [descriptor.entries.main.file], ['../main.ts'], ['nested/main.ts'], ['main.ts', 'main.ts'], [42]]) {
    assert.throws(() => parseDescriptor({ ...descriptor, legacySharedFiles: files }));
  }
});

it('validates boolean setting declarations, rejects ambiguous ids and keeps every locale complete', async () => {
  const { PROVIDER_SETTINGS } = await import('../src/providers/catalog');
  const original = descriptors.find(provider => provider.settings)!;
  const setting = original.settings![0];
  assert.deepEqual(PROVIDER_SETTINGS, descriptors.filter(provider => provider.settings).map(({ id, settings }) => ({ id, settings })));
  for (const settings of [null, [], {}, [setting, setting],
    [{ ...setting, id: '../setting' }], [{ ...setting, id: 'constructor' }],
    [{ ...setting, type: 'string' }], [{ ...setting, default: 'true' }],
    [{ ...setting, label: '' }], [{ ...setting, description: '<html>' }]]) {
    assert.throws(() => parseDescriptor({ ...original, settings }));
  }
  const { LANGUAGES } = await import('../src/language');
  for (const { locale } of LANGUAGES) {
    const catalog = JSON.parse(readFileSync(path.join(root, '_locales', locale, 'messages.json'), 'utf8'));
    for (const provider of descriptors) for (const setting of provider.settings ?? []) {
      for (const key of [setting.label, setting.description]) {
        assert.ok(catalog[key]?.message, `${locale}/${key}`);
        if (key.startsWith('provider')) assert.ok(catalog[key]?.description, `${locale}/${key}: translator context`);
      }
    }
  }
});


it('declares AutoTheater settings exactly for the advertised capabilities, with existing-user defaults on', async () => {
  const { PROVIDER_CAPABILITIES } = await import('../src/providers/capabilities');
  const supported = PROVIDER_CAPABILITIES.filter(provider => provider.capabilities.autoTheater.status !== 'no').map(provider => provider.id).sort();
  const settings = descriptors.filter(provider => provider.settings?.some(setting => setting.id === 'autoTheater'));
  assert.deepEqual(settings.map(provider => provider.id).sort(), supported);
  for (const provider of settings) assert.equal(provider.settings!.find(setting => setting.id === 'autoTheater')!.default, true);
});
