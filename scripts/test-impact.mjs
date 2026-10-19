import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { discoverTests } from './run-tests.mjs';
import { shouldRunChecks } from './ci-changes.mjs';

// Add shared inputs here when they cannot be represented by an import edge.
export const isFullRun = file => /^(?:package\.json|pnpm-(?:lock|workspace)\.[^/]+|tsconfig[^/]*\.json|manifest\.json|vite\.config\.[^/]+)$/.test(file)
  || /^(?:scripts\/(?:build[^/]*|run-tests\.mjs|ci-changes\.mjs|test-impact(?:\.test)?\.mjs)|(?:src\/)?test-utils\/|test\/fixtures\/|\.github\/(?:workflows|actions)\/)/.test(file);
const isBuildInput = file => isFullRun(file) && !/^(?:(?:src\/)?test-utils\/|test\/fixtures\/|scripts\/(?:run-tests|ci-changes|test-impact))/.test(file);
const ENTRIES = ['src/entries/content.ts', 'src/entries/main-world.ts', 'src/entries/background.ts', 'popup/popup.ts', 'options/options.ts'];
const BUNDLE_ENTRIES = [...ENTRIES, 'scripts/build.ts', 'vite.config.ts'];
const localeTest = file => /(?:locales|localization|i18n|store-listings|safe-dom|rte-settings|whatsNew-(?:content|release)|cc-menu-rows|settings-rows)(?:\.browser)?\.test\./.test(file);
const codeFile = file => /\.(?:[cm]?[jt]sx?)$/.test(file) && !file.endsWith('.d.ts');

export function changedFiles(base, head = 'HEAD', root = process.cwd()) {
  // No rename detection: both the deleted and added paths participate.
  return execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`, '--'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
}

export function snapshot(ref, root) {
  const dir = mkdtempSync(join(tmpdir(), 'tme-impact-'));
  try {
    const archive = join(dir, 'snapshot.tar');
    execFileSync('git', ['archive', '--output', archive, ref], { cwd: root });
    execFileSync('tar', ['-xf', archive, '-C', dir]);
    rmSync(archive);
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
      builder.onResolve({ filter: /\?(?:raw|inline)$/ }, args => ({ path: resolve(args.resolveDir, args.path.replace(/\?(?:raw|inline)$/, '')), namespace: 'raw' }));
      builder.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: 'text' }));
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
    for (const match of text.matchAll(/(?<=["'`])(?:\.\.?\/)*([\w@./-]+)(?=["'`])/g)) {
      const key = match[1];
      if (!match[0].includes('/') && !key.includes('.')) continue;
      for (const target of suffixes.get(key) ?? []) { edges.add(target); if (!graph.has(target)) graph.set(target, new Set()); }
    }
    // Built-extension tests consume all shipped runtime code, not their own imports.
    if (/['"`](?:dist(?:\/|['"`])|(?:chrome|firefox)-unpacked)/.test(text)) for (const entry of BUNDLE_ENTRIES) edges.add(entry);
    graph.set(file, edges);
  }
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
  }
  for (const entry of entries) if (!graph.has(entry)) throw new Error(`Missing extension entry: ${entry}`);
  return graph;
}

export function selectTests(tests, changed, graph, entries) {
  const full = reason => ({ files: tests, smoke: true, full: true, reason });
  if (!Array.isArray(changed) || changed.length === 0) return full('Missing or empty changed-file metadata');
  const shared = changed.find(isFullRun);
  if (shared && changed.some(isBuildInput)) return full(`Shared input: ${shared}`);
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
  const smokeRoots = entries ?? [...BUNDLE_ENTRIES, ...[...graph.keys()].filter(file =>
    /^scripts\/(?:smoke[^/]*|smoke\/.*)\.ts$/.test(file) && !file.endsWith('.test.ts'))];
  const smoke = locales || smokeRoots.some(file => reaches(file, targets));
  if (shared) return { ...full(`Shared input: ${shared}`), smoke };
  const unknown = [...targets].find(file => !graph.has(file) && !tests.includes(file)
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

export async function impact({ root = process.cwd(), gitRoot = root, base = 'origin/main', head = 'HEAD' } = {}) {
  const tests = discoverTests(root);
  let previous;
  try {
    const changed = changedFiles(base, head, gitRoot);
    const early = selectTests(tests, changed, null);
    if (changed.some(isBuildInput)) return { ...early, total: tests.length };
    const mergeBase = execFileSync('git', ['merge-base', base, head], { cwd: gitRoot, encoding: 'utf8' }).trim();
    previous = snapshot(mergeBase, gitRoot);
    const currentFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', head], { cwd: gitRoot, encoding: 'utf8' }).trim().split('\n');
    const oldFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', mergeBase], { cwd: gitRoot, encoding: 'utf8' }).trim().split('\n');
    const graph = await readGraph(root, currentFiles);
    const oldGraph = await readGraph(previous, oldFiles);
    for (const [file, edges] of oldGraph) graph.set(file, new Set([...(graph.get(file) ?? []), ...edges]));
    return { ...selectTests(tests, changed, graph), total: tests.length };
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
  const selection = await impact({ base: process.argv[2] || 'origin/main' });
  const output = '.test-impact.json';
  writeFileSync(output, JSON.stringify(selection, null, 2) + '\n');
  console.log(report(selection));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report(selection));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `smoke=${selection.smoke}\n`);
}
