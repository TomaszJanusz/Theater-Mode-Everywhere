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

import { assertProviderSources, bundledEntryFile, bundledEntrySource, catalogSource, classicEntries, contentScripts, discoverDescriptors, packagedDescriptors, parseDescriptor, providerMatches } from './provider-descriptors';

const root = path.resolve(__dirname, '..');
const descriptors = discoverDescriptors(root);
const packaged = packagedDescriptors(descriptors);
const bundled = descriptors.filter(descriptor => descriptor.packaging === 'bundled');

it('keeps descriptors, source manifest, catalog, registry and entry inventory consistent', () => {
  assertProviderSources(root, descriptors);
  assert.deepEqual(PROVIDER_CATALOG, descriptors.map(({ id, hosts }) => ({ id, hosts })));
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
    mkdirSync(path.join(directory, 'src/entries'), { recursive: true });
    writeFileSync(path.join(directory, 'src/providers/catalog.ts'), catalogSource(descriptors));
    for (const world of ['isolated', 'main'] as const) writeFileSync(path.join(directory, bundledEntryFile(world)), bundledEntrySource(descriptors, world));
    const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    manifest.content_scripts[0].js.reverse();
    writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    assert.throws(() => assertProviderSources(directory, descriptors), /manifest drift/);
    writeFileSync(path.join(directory, 'manifest.json'), readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    writeFileSync(path.join(directory, bundledEntryFile('main')), bundledEntrySource([], 'main'));
    if (bundled.length) assert.throws(() => assertProviderSources(directory, descriptors), /Bundled provider entry drift/);
    writeFileSync(path.join(directory, 'src/providers/catalog.ts'), 'stale');
    assert.throws(() => assertProviderSources(directory, descriptors), /catalog drift/);
    const value = JSON.parse(readFileSync(path.join(root, 'src/providers/soop/provider.json'), 'utf8'));
    for (const mutation of [
      { ...value, schemaVersion: 2 }, { ...value, id: 'unknown' },
      { ...value, hosts: [{ domain: 'sooplive.com/*', includeSubdomains: true }] },
      { ...value, entries: { ...value.entries, main: { file: '../other.ts', runAt: 'document_start' } } },
      { ...value, entries: { ...value.entries, main: { file: 'main.ts', runAt: 'document_idle' } } },
      { ...value, packaging: 'lazy' }
    ]) assert.throws(() => parseDescriptor(mutation));
    assert.equal(parseDescriptor({ ...value, packaging: 'bundled' }).packaging, 'bundled');
    writeFileSync(path.join(directory, 'src/providers/soop/provider.json'), JSON.stringify(value));
    assert.throws(() => discoverDescriptors(directory), /Missing entry/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it('uses disjoint rules, private ordered scripts, and both dotted DNS spellings', () => {
  const rules = contentScripts(descriptors);
  for (const descriptor of packaged) {
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
      assert.deepEqual(fallback.exclude_matches, packaged.flatMap(providerMatches));
    }
  }
  // A bundled provider stays in the shared scripts: no partition, no exclusion from the fallback.
  for (const descriptor of bundled) {
    assert.ok(!rules.some(rule => rule.js.some(file => file.startsWith(`providers/${descriptor.id}/`))));
    assert.ok(!rules.some(rule => rule.exclude_matches?.some(pattern => providerMatches(descriptor).includes(pattern))));
  }
});

it('each descriptor entry actually registers its own hooks in its own world before startup', async () => {
  const chatWorlds = new Map<string, number>();
  for (const descriptor of descriptors) for (const world of ['isolated', 'main'] as const) {
    const registry = createProviderRegistry(descriptor.hosts[0].domain);
    const api: ProviderRuntimeApi = { contractVersion: 1, register: registry.register, start() {},
      services: { requestPageFetch: async () => null, serviceElementToken: () => 1 } };
    const window = { location: { hostname: descriptor.hosts[0].domain }, [Symbol.for(`theater-everywhere.provider-runtime.${world}`)]: api };
    const code = await bundleQueryModules([`import './providers/${descriptor.id}/${descriptor.entries[world].file}';`]);
    runInNewContext(code, { window, URL });
    assert.equal(registry.state(descriptor.id), 'ready', `${descriptor.id}/${world} registration mismatch`);
    const hooks = registry.get(descriptor.id)!;
    assert.ok(hooks.watchPlayback);
    // Isolated-only hooks never register in MAIN, and MAIN installation never in the isolated world.
    assert.equal(Boolean(hooks.createAdapter), world === 'isolated');
    for (const name of ['navigation', 'serviceActions', 'launcherPlacement', 'timeline', 'timelineMarkers'] as const) assert.ok(world === 'isolated' || !hooks[name], name);
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
      for (const descriptor of packaged) assert.ok(!inputs.some(input => input.includes(`/providers/${descriptor.id}/`)), entry.output);
      // Until its packaging flip, a bundled provider registers from the shared runtime script of each world.
      const world = { content: 'isolated', mainWorld: 'main' }[entry.output as 'content' | 'mainWorld'];
      if (world) for (const descriptor of bundled) assert.ok(inputs.some(input => input.endsWith(`/providers/${descriptor.id}/${descriptor.entries[world as 'isolated' | 'main'].file}`)), `${entry.output} misses ${descriptor.id}`);
    } else {
      assert.ok(!inputs.some(input => /(?:runtime-registration|\/registry|media-features\/probe)\.ts$/.test(input)), entry.output);
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
  for (const host of ['www.youtube.com', 'example.test', 'sooplive.com.evil.test', 'notsooplive.com', 'sooplive.co.kr', 'afreecatv.com']) {
    assert.deepEqual(manifestScriptsForUrl(manifest, `https://${host}/`), ['mainWorld.js', 'mainWorldStart.js', 'content.js', 'contentStart.js'], host);
  }
});

it('keeps exact descriptor hosts exact while folding case and terminal DNS dots', () => {
  const hosts = [{ domain: 'example.com', includeSubdomains: false }];
  for (const host of ['example.com', 'EXAMPLE.COM', 'example.com.']) assert.equal(descriptorMatchesHost(hosts, host), true);
  for (const host of ['www.example.com', 'sub.example.com', 'example.com.evil.test']) assert.equal(descriptorMatchesHost(hosts, host), false);
});
