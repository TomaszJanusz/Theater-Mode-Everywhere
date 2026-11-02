import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { build } from 'esbuild';

import { baseRef } from './base-ref.mjs';
import { shouldRunChecks } from './ci-changes.mjs';
import { discoverTests } from './run-tests.mjs';

// Add shared inputs here when they cannot be represented by an import edge.
export const isFullRun = file => /(?:^scripts\/provider-descriptors\.ts$|^src\/providers\/(?:provider-api|runtime-registration|descriptor-hosts|catalog)\.ts$|\/provider\.json$)/.test(file) || /^(?:package\.json|pnpm-(?:lock|workspace)\.[^/]+|tsconfig[^/]*\.json|manifest\.json|vitest\.config\.[^/]+|config\/vite\.config\.[^/]+)$/.test(file)
  || /^config\/eslint(?:\.config\.mjs|-rules\/)/.test(file)
  || /^(?:scripts\/(?:build[^/]*|run-tests\.mjs|ci-changes\.mjs|test-impact(?:\.test)?\.mjs)|(?:src\/)?test-utils\/|test\/fixtures\/|\.github\/(?:workflows|actions|ci-image)\/)/.test(file);
const isBuildInput = file => isFullRun(file) && !/^(?:(?:src\/)?test-utils\/|test\/fixtures\/|scripts\/(?:run-tests|ci-changes|test-impact))/.test(file);
// Read by ESLint alone: no test reads the repository's own file (eslint-ratchet.test.mjs lints a private directory), and
// the `static` job lints the whole tree on every PR. A test that does name it literally still gets an import-graph edge.
const TEST_INERT = new Set(['eslint-suppressions.json']);
// A release bump rewrites only `version`. The graph already ties these files to every reader (installed-version.ts imports
// the manifest, build.ts reads both), so such a change selects those readers instead of the whole suite.
const VERSIONED = ['manifest.json', 'package.json'];
const ENTRIES = ['src/entries/content.ts', 'src/entries/main-world.ts', 'src/entries/background.ts', 'popup/popup.ts', 'options/options.ts'];
// Stands for the provider scripts the installed extension loads next to its entries (see readGraph).
const INSTALLED_PROVIDERS = 'installed:providers';
const BUNDLE_ENTRIES = [...ENTRIES, 'src/entries/content-start.ts', 'src/entries/main-world-start.ts', 'scripts/build.ts', 'config/vite.config.ts'];
const localeTest = file => /(?:locales|localization|i18n|store-listings|safe-dom|rte-settings|whatsNew-content|update-notice|cc-menu-rows|settings-rows)(?:\.browser)?\.test\./.test(file);
// The one place this script starts git, with fixed arguments.
const git = (cwd, args, env = process.env) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' });
const codeFile = file => /\.(?:[cm]?[jt]sx?)$/.test(file) && !file.endsWith('.d.ts');

// esbuild erases type-only imports, so they have no metafile edge. They still count as dependencies (a type edit can
// change what a test exercises), and a relative specifier names exactly one file, so there is nothing to guess.
const TYPE_IMPORT = /\b(?:import|export)\s+type\b[^'"`;]*?\bfrom\s*(['"])(\.{1,2}\/[^'"\n]+)\1/g;
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.d.ts', '.mts', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js'];

function resolveRelative(fileSet, from, specifier) {
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  return RESOLVE_SUFFIXES.map(suffix => base + suffix).find(candidate => fileSet.has(candidate));
}

export function changedFiles(base, head = 'HEAD', root = process.cwd()) {
  // No rename detection: both the deleted and added paths participate.
  return git(root, ['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`, '--']).split('\0').filter(Boolean);
}

export function snapshot(ref, root) {
  const dir = mkdtempSync(join(tmpdir(), 'tme-impact-'));
  try {
    // A private index, not `git archive`: export-ignored inputs (recorded host fixtures) are imported by tests.
    const env = { ...process.env, GIT_INDEX_FILE: join(dir, '.snapshot-index') };
    git(root, ['read-tree', ref], env);
    git(root, ['checkout-index', '--all', `--prefix=${dir}/`], env);
    rmSync(env.GIT_INDEX_FILE);
    return dir;
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

export async function readGraph(root, files, entries = ENTRIES) {
  const sources = files.filter(codeFile);
  const result = await build({
    absWorkingDir: root, entryPoints: sources, outdir: '.impact-output', bundle: true,
    write: false, metafile: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent',
    loader: { '.css': 'text', '.html': 'text', '.svg': 'text', '.md': 'text' },
    plugins: [{ name: 'raw-assets', setup(builder) {
      // Vite's `?raw`/`?inline` (text) and `?url` (an asset the graph only needs the edge to) suffixes. A bare
      // package specifier is external like every other package: its version is covered by package.json/lockfile.
      builder.onResolve({ filter: /\?(?:raw|inline|url)$/ }, args => {
        const specifier = args.path.replace(/\?(?:raw|inline|url)$/, '');
        if (!/^\.{0,2}\//.test(specifier)) return { path: specifier, external: true };
        return { path: resolve(args.resolveDir, specifier), namespace: 'raw', pluginData: { asset: args.path.endsWith('?url') } };
      });
      builder.onLoad({ filter: /.*/, namespace: 'raw' }, args => args.pluginData?.asset
        ? { contents: '', loader: 'empty' }
        : { contents: readFileSync(args.path, 'utf8'), loader: 'text' });
    } }],
  });
  const graph = new Map();
  const normalize = file => relative(root, resolve(root, file.replace(/^raw:/, '').replace(/\?(?:raw|inline)$/, ''))).replaceAll('\\', '/');
  // JS consumes some styles as strings. A separate CSS build retains @import
  // and url() edges that the text loader (including ?raw/?inline) cannot see.
  const styles = files.filter(file => file.endsWith('.css'));
  const css = styles.length ? await build({
    absWorkingDir: root, entryPoints: styles, outdir: '.impact-css-output',
    bundle: true, write: false, metafile: true, packages: 'external', logLevel: 'silent',
    loader: { '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
  }) : null;
  if (css?.warnings.length) throw new Error(`Uncertain stylesheet graph: ${css.warnings[0].text}`);
  for (const metadata of [result.metafile, css?.metafile]) {
    for (const [file, input] of Object.entries(metadata?.inputs ?? {})) {
      const key = normalize(file);
      graph.set(key, new Set([...(graph.get(key) ?? []), ...input.imports.filter(edge => !edge.external).map(edge => normalize(edge.path))]));
    }
  }
  // Browser harnesses embed imports in esbuild stdin strings, read source files,
  // or pass literal entryPoints. Match those literals against every possible
  // repository suffix (not just the test directory): overselect on ambiguity.
  // This also retains type-only dependencies removed by esbuild.
  const suffixes = new Map();
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 0; i < parts.length; i++) {
      const suffix = parts.slice(i).join('/');
      for (const key of [suffix, suffix.replace(/\.(?:[cm]?[jt]sx?)$/, '')]) {
        if (!suffixes.has(key)) suffixes.set(key, new Set());
        suffixes.get(key).add(file);
      }
    }
  }
  const fileSet = new Set(files);
  // Specifiers esbuild resolved from real import statements, counted per file. Their targets are already exact edges.
  const resolved = new Map();
  for (const [file, input] of Object.entries(result.metafile.inputs)) {
    const counts = new Map();
    for (const edge of input.imports) if (edge.original) counts.set(edge.original, (counts.get(edge.original) ?? 0) + 1);
    resolved.set(normalize(file), counts);
  }
  for (const file of sources) {
    const text = readFileSync(join(root, file), 'utf8');
    // Computed module specifiers have no reliable static edge. The existing
    // createRequire wrapper only locates the external esbuild package in Vite.
    const moduleText = text.replaceAll("require(createRequire(require.resolve('vite')).resolve('esbuild'))", '');
    if (/\b(?:import|require)\s*\(\s*(?:[^'"`\s]|`[^`]*\$\{)/.test(moduleText)) {
      throw new Error(`Computed module input in ${file}`);
    }
    const edges = graph.get(file) ?? new Set();
    if (text.includes('_locales')) edges.add('_locales/');
    const unclaimed = new Map(resolved.get(file));
    for (const [, , specifier] of text.matchAll(TYPE_IMPORT)) {
      const target = resolveRelative(fileSet, file, specifier);
      if (!target) continue;
      edges.add(target);
      if (!graph.has(target)) graph.set(target, new Set());
      unclaimed.set(specifier, (unclaimed.get(specifier) ?? 0) + 1);
    }
    for (const match of text.matchAll(/(?<=["'`])(?:\.\.?\/)*([\w@./-]+)(?=["'`])/g)) {
      const key = match[1];
      if (!match[0].includes('/') && !key.includes('.')) continue;
      // A literal that is a real import statement needs no suffix guess; one more occurrence than imports (such as
      // a copy inside a bundled stdin string) still gets every suffix match.
      if (unclaimed.get(match[0]) > 0) { unclaimed.set(match[0], unclaimed.get(match[0]) - 1); continue; }
      for (const target of suffixes.get(key) ?? []) { edges.add(target); if (!graph.has(target)) graph.set(target, new Set()); }
    }
    // Built-extension tests consume all shipped runtime code, not their own imports.
    if (/['"`](?:dist(?:\/|['"`])|(?:chrome|firefox)-unpacked)/.test(text)) for (const entry of [...BUNDLE_ENTRIES, INSTALLED_PROVIDERS]) edges.add(entry);
    graph.set(file, edges);
  }
  // Static provider entries are manifest dependencies, not TypeScript imports of core.
  const providerInputs = files.filter(file => /^src\/providers\/[^/]+\/provider\.json$/.test(file));
  const providerEntries = [];
  for (const file of providerInputs) {
    const descriptor = JSON.parse(readFileSync(join(root, file), 'utf8'));
    const directory = file.slice(0, file.lastIndexOf('/') + 1);
    const entries = Object.values(descriptor.entries).map(entry => directory + entry.file);
    graph.set(file, new Set(entries));
    providerEntries.push(file, ...entries);
  }
  // Only the built extension loads these beside content.js: a test that bundles an entry from source gets a provider
  // through its own import of it, so the entries themselves must not depend on every provider.
  graph.set(INSTALLED_PROVIDERS, new Set(providerEntries));
  // HTML is loaded by the browser rather than imported by these scripts.
  for (const surface of ['popup', 'options']) {
    const html = `${surface}/${surface}.html`;
    graph.get(`${surface}/${surface}.ts`)?.add(html);
    if (files.includes(html)) {
      const edges = graph.get(html) ?? new Set();
      // These entry pages load their stylesheet via <link>, including tests
      // which derive the surface path dynamically from 'popup' or 'options'.
      const css = `${surface}/${surface}.css`;
      if (files.includes(css)) edges.add(css);
      graph.set(html, edges);
    }
  }
  // Repository-wide guards inspect files without importing them.
  for (const file of sources) {
    if (/^(?:src|popup|options)\//.test(file) && !/\.test\./.test(file)) graph.get('src/safe-dom.test.ts')?.add(file);
    if (/\.test\.|^tools\/|^src\/test-utils\/|^scripts\/smoke/.test(file)) graph.get('scripts/test-determinism.test.ts')?.add(file);
    if (/\.test\.ts$/.test(file)) graph.get('scripts/test-harness.test.ts')?.add(file);
  }
  for (const entry of entries) if (!graph.has(entry)) throw new Error(`Missing extension entry: ${entry}`);
  return graph;
}

// A change to a manifest or package.json that touches only `version`. A file that is missing on a side, not JSON or
// otherwise different is not version-only, so it stays a shared input.
export function versionOnlyFiles(changed, base, head, root = process.cwd()) {
  const read = (ref, file) => {
    try {
      const { version, ...rest } = JSON.parse(git(root, ['show', `${ref}:${file}`]));
      return { rest, versioned: typeof version === 'string' };
    } catch {
      return undefined;
    }
  };
  return new Set(VERSIONED.filter(file => {
    if (!changed.includes(file)) return false;
    const [before, after] = [read(base, file), read(head, file)];
    return before?.versioned && after?.versioned && isDeepStrictEqual(before.rest, after.rest);
  }));
}

export function selectTests(tests, changed, graph, { entries, versionOnly = new Set() } = {}) {
  const full = reason => ({ files: tests, smoke: true, full: true, reason });
  if (!Array.isArray(changed) || changed.length === 0) return full('Missing or empty changed-file metadata');
  const isShared = file => isFullRun(file) && !versionOnly.has(file);
  const shared = changed.find(isShared);
  if (shared && changed.some(file => isShared(file) && isBuildInput(file))) return full(`Shared input: ${shared}`);
  if (!(graph instanceof Map)) return full('Import graph unavailable');
  const reaches = (file, targets, seen = new Set()) => {
    if (targets.has(file)) return true;
    if (seen.has(file)) return false;
    seen.add(file);
    return [...(graph.get(file) ?? [])].some(dep => reaches(dep, targets, seen));
  };
  const targets = new Set(changed.filter(file => !file.startsWith('_locales/')));
  const locales = changed.some(file => file.startsWith('_locales/'));
  // Harness roots trigger smoke without becoming inputs of dist-dependent tests.
  const smokeRoots = entries ?? [...BUNDLE_ENTRIES, INSTALLED_PROVIDERS, ...[...graph.keys()].filter(file =>
    /^scripts\/(?:smoke[^/]*|smoke\/.*)\.ts$/.test(file) && !file.endsWith('.test.ts'))];
  const smoke = locales || smokeRoots.some(file => reaches(file, targets));
  if (shared) return { ...full(`Shared input: ${shared}`), smoke };
  const unknown = [...targets].find(file => !graph.has(file) && !tests.includes(file) && !TEST_INERT.has(file)
    && shouldRunChecks([file]));
  if (unknown) return full(`Unmodelled input: ${unknown}`);
  const unmodelledStyle = changed.find(file => file.endsWith('.css')
    && !tests.some(test => reaches(test, new Set([file]))));
  if (unmodelledStyle) return full(`No modelled stylesheet test consumer: ${unmodelledStyle}`);
  return {
    files: tests.filter(file => reaches(file, targets) || (locales && (localeTest(file) || reaches(file, new Set(['_locales/']))))),
    smoke, full: false,
    reason: 'Changed tests and transitive imports (including literal browser harness inputs); locale tests for catalogs',
  };
}

export async function impact({ root = process.cwd(), gitRoot = root, base = baseRef(), head = 'HEAD' } = {}) {
  const tests = discoverTests(root);
  let previous;
  try {
    const changed = changedFiles(base, head, gitRoot);
    const mergeBase = git(gitRoot, ['merge-base', base, head]).trim();
    const versionOnly = versionOnlyFiles(changed, mergeBase, head, gitRoot);
    const early = selectTests(tests, changed, null, { versionOnly });
    if (changed.some(file => isBuildInput(file) && !versionOnly.has(file))) return { ...early, total: tests.length };
    previous = snapshot(mergeBase, gitRoot);
    const currentFiles = git(gitRoot, ['ls-tree', '-r', '--name-only', head]).trim().split('\n');
    const oldFiles = git(gitRoot, ['ls-tree', '-r', '--name-only', mergeBase]).trim().split('\n');
    const graph = await readGraph(root, currentFiles);
    const oldGraph = await readGraph(previous, oldFiles);
    for (const [file, edges] of oldGraph) graph.set(file, new Set([...(graph.get(file) ?? []), ...edges]));
    return { ...selectTests(tests, changed, graph, { versionOnly }), total: tests.length };
  } catch (error) {
    return { files: tests, smoke: true, full: true, total: tests.length, reason: `Fallback to all tests: ${error.message}` };
  } finally {
    if (previous) rmSync(previous, { recursive: true, force: true });
  }
}

export function report(selection) {
  return `### PR test impact\n\n${selection.files.length}/${selection.total} test files. ${selection.reason}\n\nChromium smoke: ${selection.smoke ? 'run (shipped inputs affected or conservative fallback)' : 'skip (no installed extension entrypoint affected)'}.\n\nSelected files:\n\n${selection.files.map(file => `- \`${file}\``).join('\n') || '(none: no test dependencies affected)'}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const selection = await impact({ base: process.argv[2] || baseRef() });
  const output = '.test-impact.json';
  writeFileSync(output, JSON.stringify(selection, null, 2) + '\n');
  console.log(report(selection));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report(selection));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `smoke=${selection.smoke}\n`);
}
