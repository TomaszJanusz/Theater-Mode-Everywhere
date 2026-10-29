import * as fs from 'fs';
import assert from 'node:assert/strict';
import * as path from 'path';

import { classicEntries, contentScripts, discoverDescriptors } from './provider-descriptors';

// `\s*` covers minified forms such as `export{` and `import"x"` that a
// whitespace-requiring pattern would miss. Dynamic imports are rejected separately:
// every manifest entry must execute without asynchronous chunk loading.
const ESM_IMPORT_RE = /(?:^|[\n;])\s*(?:import\s*(?:['"`]|\*|\{|\w)|export\s*(?:\{|\*|default\b|async\b|function\b|class\b|const\b|let\b|var\b))/m;

export function assertSelfContainedScript(filePath: string): void {
  const source = fs.readFileSync(filePath, 'utf8');
  if (ESM_IMPORT_RE.test(source) || /\bimport\s*\(/.test(source)) {
    throw new Error(`${path.basename(filePath)} contains ESM imports; classic extension scripts must stay self-contained.`);
  }
}

const IIFE_START_RE = /^(?:\(\s*function\b|\(\s*\(\s*\)\s*=>|!\s*function\b)/;

/** Skips whitespace and leading block comments in linear time; an unterminated comment leaves nothing. */
function skipLeadingTrivia(source: string): string {
  let rest = source.trimStart();
  while (rest.startsWith('/*')) {
    const end = rest.indexOf('*/', 2);
    if (end === -1) return '';
    rest = rest.slice(end + 2).trimStart();
  }
  return rest;
}

/** Drops trailing whitespace and line comments (e.g. a sourceMappingURL), in linear time. */
function trimTrailingTrivia(source: string): string {
  let rest = source.trimEnd();
  for (let start = rest.lastIndexOf('\n'); rest.slice(start + 1).startsWith('//'); start = rest.lastIndexOf('\n')) {
    rest = rest.slice(0, Math.max(start, 0)).trimEnd();
  }
  return rest;
}

const IIFE_END_RE = /(?:\}\)\(\)|\}\(\)\)|\)\(\))\s*;?$/;

/**
 * The MAIN-world bundle shares its global scope with the host page. Top-level minified names
 * (`function va`, `const oo`) would become page globals: they shadow the page's own (a site
 * analytics `window.va` was replaced by our function and threw into its callers) and a page
 * `let`/`const` of the same name fails to parse. Everything must live inside one function scope.
 */
export function assertScopedScript(filePath: string): void {
  const source = fs.readFileSync(filePath, 'utf8');
  // Start and end together rule out a declaration before or after the wrapper call.
  if (!IIFE_START_RE.test(skipLeadingTrivia(source)) || !IIFE_END_RE.test(trimTrailingTrivia(source))) {
    throw new Error(`${path.basename(filePath)} is not wrapped in an IIFE; its top-level names would leak into the page's global scope.`);
  }
}

export function assertSelfContainedBundles(dir: string): void {
  const descriptors = discoverDescriptors();
  const expected = classicEntries(descriptors).map(entry => `${entry.output}.js`);
  const manifestPath = path.join(dir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(manifest.content_scripts, contentScripts(descriptors), 'Packaged provider manifest drift');
    const scripts = [...new Set<string>(manifest.content_scripts.flatMap((entry: { js: string[] }) => entry.js))].sort();
    assert.deepEqual(scripts, expected.toSorted(), 'Provider output inventory disagrees with manifest');
    assert.ok(!manifest.permissions.includes('scripting'), 'Static providers need no scripting permission');
    for (const rule of manifest.web_accessible_resources ?? []) {
      assert.ok(rule.resources.every((file: string) => !/\.js$|\*/.test(file)), 'Provider JS must stay private');
    }
  }
  for (const name of expected) {
    assertSelfContainedScript(path.join(dir, name));
    assertScopedScript(path.join(dir, name));
  }
}

/** Packaged background imports require module loading in either browser. */
export function assertBackgroundScriptLoading(dir: string): void {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const background = manifest.background;
  if (background.type === 'module') return;
  const scripts: string[] = background.scripts ?? [background.service_worker];
  for (const script of scripts) assertSelfContainedScript(path.join(dir, script));
}
