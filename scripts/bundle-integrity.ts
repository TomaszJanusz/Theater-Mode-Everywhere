import * as fs from 'fs';
import * as path from 'path';

// `\s*` covers minified forms such as `export{` and `import"x"` that a
// whitespace-requiring pattern would miss. Dynamic `import(` is not an
// ESM statement and is left to the bundler (`inlineDynamicImports`).
const ESM_IMPORT_RE = /(?:^|[\n;])\s*(?:import\s*(?:['"`]|\*|\{|\w)|export\s*(?:\{|\*|default\b|async\b|function\b|class\b|const\b|let\b|var\b))/m;

export function assertSelfContainedScript(filePath: string): void {
  const source = fs.readFileSync(filePath, 'utf8');
  if (ESM_IMPORT_RE.test(source)) {
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

/**
 * The MAIN-world bundle shares its global scope with the host page. Top-level minified names
 * (`function va`, `const oo`) would become page globals: they shadow the page's own (a site
 * analytics `window.va` was replaced by our function and threw into its callers) and a page
 * `let`/`const` of the same name fails to parse. Everything must live inside one function scope.
 */
export function assertScopedScript(filePath: string): void {
  if (!IIFE_START_RE.test(skipLeadingTrivia(fs.readFileSync(filePath, 'utf8')))) {
    throw new Error(`${path.basename(filePath)} is not wrapped in an IIFE; its top-level names would leak into the page's global scope.`);
  }
}

export function assertSelfContainedBundles(dir: string): void {
  for (const name of ['content.js', 'mainWorld.js'] as const) {
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
