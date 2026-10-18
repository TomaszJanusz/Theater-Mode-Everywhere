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

export function assertSelfContainedBundles(dir: string): void {
  for (const name of ['content.js', 'mainWorld.js'] as const) {
    assertSelfContainedScript(path.join(dir, name));
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
