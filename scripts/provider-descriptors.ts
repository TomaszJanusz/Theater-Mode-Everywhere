import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { MEDIA_PROVIDER_IDS, type MediaProviderId } from '../src/media-features/provider-flags';
import { descriptorMatchesHost } from '../src/providers/descriptor-hosts';
import type { MediaFetchRule } from '../src/providers/media-fetch-rules';


export type ProviderDescriptor = {
  schemaVersion: 1;
  id: MediaProviderId;
  hosts: Array<{ domain: string; includeSubdomains: boolean }>;
  /** Canonical HUD home destination, also available when the data integration is off. */
  home?: string;
  /** Static URL rules also used by the background broker, without a document registry. */
  mediaFetch?: MediaFetchRule[];
  /** Exact pre-existing shared modules during a staged extraction; new implementation stays host-only. */
  legacySharedFiles?: string[];
  entries: Record<'isolated' | 'main', { file: string; runAt: 'document_start' }>;
};
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate before using descriptor paths to read sources or write package outputs. */
export function parseDescriptor(value: unknown): ProviderDescriptor {
  assert.ok(record(value) && value.schemaVersion === 1, 'Unknown provider schema');
  const id = MEDIA_PROVIDER_IDS.find(id => id === value.id);
  assert.ok(id, 'Unknown provider id');
  assert.ok(Array.isArray(value.hosts) && value.hosts.length > 0, 'Missing provider hosts');
  const hosts = value.hosts.map((host: unknown) => {
    assert.ok(record(host) && typeof host.domain === 'string' && /^(?:[a-z0-9]+(?:-[a-z0-9]+)*\.)+[a-z]{2,}$/.test(host.domain), 'Invalid provider host');
    assert.equal(typeof host.includeSubdomains, 'boolean');
    return { domain: host.domain, includeSubdomains: host.includeSubdomains === true };
  });
  let home: string | undefined;
  if (value.home !== undefined) {
    assert.equal(typeof value.home, 'string', 'Invalid provider home');
    const url = new URL(String(value.home));
    assert.ok(url.protocol === 'https:' && !url.username && !url.password && !url.port
      && descriptorMatchesHost(hosts, url.hostname), 'Provider home must be HTTPS on a declared host');
    home = url.href;
  }
  let mediaFetch: MediaFetchRule[] | undefined;
  if (value.mediaFetch !== undefined) {
    assert.ok(Array.isArray(value.mediaFetch) && value.mediaFetch.length > 0, 'Invalid media fetch rules');
    mediaFetch = value.mediaFetch.map((rule: unknown) => {
      assert.ok(record(rule) && typeof rule.host === 'string' && /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(rule.host), 'Invalid media fetch host');
      assert.ok(rule.kind === 'caption-track' || rule.kind === 'storyboard-vtt' || rule.kind === 'storyboard-json' || rule.kind === 'chapters', 'Invalid media fetch kind');
      assert.ok(typeof rule.pathname === 'string' && rule.pathname.startsWith('^/') && rule.pathname.endsWith('$') && rule.pathname.length <= 512, 'Media fetch pathname must be anchored');
      assert.equal(new RegExp(rule.pathname).test(''), false, 'Media fetch pathname must not match an empty path');
      return { kind: rule.kind, host: rule.host, pathname: rule.pathname };
    });
  }
  let legacySharedFiles: string[] | undefined;
  if (value.legacySharedFiles !== undefined) {
    assert.ok(Array.isArray(value.legacySharedFiles) && value.legacySharedFiles.length > 0, 'Invalid legacy shared files');
    assert.ok(value.legacySharedFiles.every(file => typeof file === 'string' && /^[a-z][a-z0-9-]*\.ts$/.test(file)), 'Invalid legacy shared file');
    assert.equal(new Set(value.legacySharedFiles).size, value.legacySharedFiles.length, 'Duplicate legacy shared file');
    legacySharedFiles = value.legacySharedFiles;
  }
  assert.ok(record(value.entries), 'Missing entries');
  const entry = (world: 'isolated' | 'main') => {
    const item = value.entries && record(value.entries) ? value.entries[world] : null;
    assert.ok(record(item) && typeof item.file === 'string' && /^[a-z][a-z0-9-]*\.ts$/.test(item.file), 'Invalid provider entry');
    assert.equal(item.runAt, 'document_start', 'Provider must be ready before startup');
    return { file: item.file, runAt: 'document_start' as const };
  };
  return { schemaVersion: 1, id, hosts, ...(home ? { home } : {}), ...(mediaFetch ? { mediaFetch } : {}), ...(legacySharedFiles ? { legacySharedFiles } : {}), entries: { isolated: entry('isolated'), main: entry('main') } };
}

export function discoverDescriptors(root = process.cwd()): ProviderDescriptor[] {
  const directory = path.join(root, 'src/providers');
  const descriptors = readdirSync(directory, { withFileTypes: true }).filter(item => item.isDirectory())
    .map(item => path.join(directory, item.name, 'provider.json')).filter(existsSync).sort()
    .map(file => {
      const descriptor = parseDescriptor(JSON.parse(readFileSync(file, 'utf8')));
      assert.equal(path.basename(path.dirname(file)), descriptor.id, 'Provider directory must match id');
      for (const entry of Object.values(descriptor.entries)) assert.ok(existsSync(path.join(path.dirname(file), entry.file)), `Missing entry ${entry.file}`);
      return descriptor;
    });
  const ids = new Set<string>();
  const hosts: ProviderDescriptor['hosts'] = [];
  for (const descriptor of descriptors) {
    assert.ok(!ids.has(descriptor.id), `Duplicate provider ${descriptor.id}`);
    ids.add(descriptor.id);
    for (const host of descriptor.hosts) {
      assert.ok(!hosts.some(other => other.domain === host.domain
        || (other.includeSubdomains && host.domain.endsWith(`.${other.domain}`))
        || (host.includeSubdomains && other.domain.endsWith(`.${host.domain}`))), 'Overlapping provider hosts');
      hosts.push(host);
    }
  }
  return descriptors;
}

export function providerMatches(descriptor: ProviderDescriptor): string[] {
  // DNS permits a terminal dot. Match both spellings, as the runtime's normalizeHost does.
  return descriptor.hosts.flatMap(host => ['', '.'].map(dot => `*://${host.includeSubdomains ? '*.' : ''}${host.domain}${dot}/*`));
}

export function classicEntries(descriptors: ProviderDescriptor[]) {
  return [
    { output: 'content', source: 'src/entries/content.ts' },
    { output: 'mainWorld', source: 'src/entries/main-world.ts' },
    ...descriptors.flatMap(descriptor => (['isolated', 'main'] as const).map(world => ({
      output: `providers/${descriptor.id}/${world}`, source: `src/providers/${descriptor.id}/${descriptor.entries[world].file}`
    }))),
    { output: 'contentStart', source: 'src/entries/content-start.ts' },
    { output: 'mainWorldStart', source: 'src/entries/main-world-start.ts' }
  ];
}

export type ContentScriptRule = {
  matches: string[];
  exclude_matches?: string[];
  js: string[];
  css?: string[];
  world?: string;
  run_at: string;
  all_frames: boolean;
};

export function contentScripts(descriptors: ProviderDescriptor[]): ContentScriptRule[] {
  const excluded = descriptors.flatMap(providerMatches);
  return (['isolated', 'main'] as const).flatMap(world => {
    const runtime = world === 'main' ? 'mainWorld.js' : 'content.js';
    const start = world === 'main' ? 'mainWorldStart.js' : 'contentStart.js';
    const common = { run_at: 'document_start', all_frames: true, ...(world === 'main' ? { world: 'MAIN' } : { css: ['content.css'] }) };
    return [
      { matches: ['<all_urls>'], ...(excluded.length ? { exclude_matches: excluded } : {}), js: [runtime, start], ...common },
      ...descriptors.map(descriptor => ({ matches: providerMatches(descriptor), js: [runtime, `providers/${descriptor.id}/${world}.js`, start], ...common }))
    ];
  });
}

export function catalogSource(descriptors: ProviderDescriptor[]): string {
  return '// Generated by scripts/provider-descriptors.ts; edit provider.json instead.\nexport const PROVIDER_CATALOG = '
    + JSON.stringify(descriptors.map(({ id, hosts, home, mediaFetch }) => ({ id, hosts, ...(home ? { home } : {}), ...(mediaFetch ? { mediaFetch } : {}) })), null, 2) + ' as const;\n';
}

export function assertProviderSources(root: string, descriptors: ProviderDescriptor[]): void {
  assert.equal(readFileSync(path.join(root, 'src/providers/catalog.ts'), 'utf8'), catalogSource(descriptors), 'Provider catalog drift; run pnpm exec tsx scripts/provider-descriptors.ts');
  const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.content_scripts, contentScripts(descriptors), 'Provider manifest drift; run pnpm exec tsx scripts/provider-descriptors.ts');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const descriptors = discoverDescriptors();
  writeFileSync('src/providers/catalog.ts', catalogSource(descriptors));
  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
  manifest.content_scripts = contentScripts(descriptors);
  writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
}

/** Diagnostic injection follows the installed manifest, including per-frame host admission. */
export function manifestScriptsForUrl(manifest: { content_scripts: Array<{ matches: string[]; exclude_matches?: string[]; js: string[]; world?: string }> }, href: string): string[] {
  const url = new URL(href);
  const matches = (pattern: string) => {
    if (pattern === '<all_urls>') return ['http:', 'https:', 'file:', 'ftp:'].includes(url.protocol);
    const parts = /^(\*|https?|file|ftp):\/\/([^/]+)\/\*$/.exec(pattern);
    if (!parts || (parts[1] === '*' ? !['http:', 'https:'].includes(url.protocol) : `${parts[1]}:` !== url.protocol)) return false;
    const domain = parts[2];
    return domain.startsWith('*.') ? url.hostname === domain.slice(2) || url.hostname.endsWith(domain.slice(1)) : url.hostname === domain;
  };
  return [...manifest.content_scripts].sort((a, b) => Number(b.world === 'MAIN') - Number(a.world === 'MAIN'))
    .filter(rule => rule.matches.some(matches) && !rule.exclude_matches?.some(matches)).flatMap(rule => rule.js);
}

/** Incremental extraction permits only enumerated legacy modules, never new host-only code. */
export function isHostOnlySource(source: string, descriptor: ProviderDescriptor): boolean {
  const relative = source.split(`/src/providers/${descriptor.id}/`)[1];
  return relative !== undefined && !descriptor.legacySharedFiles?.includes(relative);
}
