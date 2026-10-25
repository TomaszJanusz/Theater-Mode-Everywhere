import { readFileSync } from 'node:fs';
import path from 'node:path';

import { build, type Plugin } from 'esbuild';

import { readStylesheet } from './styles';

// Async twin of `bundleModules` (player-boot.ts) for entries the build resolves with Vite's
// `?raw` / `?inline` imports (options page, dialogs, license text). esbuild's sync API takes no plugins.

const SRC = new URL('../', import.meta.url).pathname;
const bundles = new Map<string, Promise<string>>();

/** Vite's `?raw` and `?inline` query imports as text; stylesheets get their `@import`s inlined. */
export const queryImports: Plugin = {
  name: 'query-imports',
  setup(builder) {
    builder.onResolve({ filter: /\?(?:raw|inline)$/ }, args => ({
      path: path.resolve(args.resolveDir, args.path.replace(/\?\w+$/, '')), namespace: 'query'
    }));
    builder.onLoad({ filter: /.*/, namespace: 'query' }, args => ({
      contents: args.path.endsWith('.css') ? readStylesheet(args.path) : readFileSync(args.path, 'utf8'), loader: 'text'
    }));
  }
};

/**
 * One IIFE of `export … from '<path relative to src/>'` lines (or side-effect imports such as
 * `import '../options/options';`) exposed as `globalName`. Cached for the process per entry set;
 * `plugins` (named, since the cache key uses their names) run after {@link queryImports}.
 */
export function bundleQueryModules(exports: readonly string[], globalName = 'TheaterTest', plugins: readonly Plugin[] = []): Promise<string> {
  const contents = exports.join('\n');
  const key = [globalName, contents, ...plugins.map(plugin => plugin.name)].join('\n');
  let pending = bundles.get(key);
  if (!pending) {
    pending = build({
      stdin: { contents, resolveDir: SRC, loader: 'ts' }, plugins: [queryImports, ...plugins],
      bundle: true, write: false, format: 'iife', globalName, platform: 'browser', target: 'es2022', logLevel: 'silent'
    }).then(result => result.outputFiles[0].text);
    bundles.set(key, pending);
  }
  return pending;
}
