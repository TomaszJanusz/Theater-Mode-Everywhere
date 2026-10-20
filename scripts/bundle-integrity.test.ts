import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { assertBackgroundScriptLoading, assertScopedScript, assertSelfContainedScript } from './bundle-integrity';

const requireFromVite = createRequire(path.resolve(__dirname, '../node_modules/vite/package.json'));

function minifyWithViteEsbuild(source: string): string {
  const pkg = requireFromVite.resolve('esbuild/package.json');
  const bin = path.join(path.dirname(pkg), 'bin', 'esbuild');
  const dir = mkdtempSync(path.join(tmpdir(), 'te-esbuild-'));
  const input = path.join(dir, 'in.js');
  writeFileSync(input, source);
  try {
    return execFileSync(bin, [input, '--minify'], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function withScript(source: string, run: (filePath: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'te-bundle-'));
  const filePath = path.join(dir, 'content.js');
  writeFileSync(filePath, source);
  try {
    run(filePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('bundle integrity gate', () => {
  it('rejects top-level declarations that would leak into the page global scope', () => {
    for (const source of ['function va(t,e){return t}va(1,2);', 'const oo=1;(function(){})();', 'var a=1;']) {
      withScript(source, (filePath) => {
        assert.throws(() => assertScopedScript(filePath), /IIFE/);
      });
    }
  });

  it('accepts a classic IIFE', () => {
    withScript('(function(){ var x = 1; })();', (filePath) => {
      assert.doesNotThrow(() => assertSelfContainedScript(filePath));
    });
  });

  it('rejects namespace, mixed, side-effect imports and exports', () => {
    const samples = [
      'import * as foo from "./x.js";',
      'import foo, { bar } from "./x.js";',
      'import "./x.js";',
      'export const x = 1;',
      'export default function x() {}',
      'export { foo } from "./x.js";',
      'export{foo};',
      'import"x.js";',
      'import{foo}from"x.js";'
    ];
    for (const source of samples) {
      withScript(source, (filePath) => {
        assert.throws(() => assertSelfContainedScript(filePath), /ESM/);
      });
    }
  });

  it('accepts minified classic output and rejects a minified re-export', () => {
    const classic = minifyWithViteEsbuild(
      '(function originalName(){ const value = 1; return value; })();'
    );
    withScript(classic, (filePath) => {
      assert.doesNotThrow(() => assertSelfContainedScript(filePath));
    });

    const reexport = minifyWithViteEsbuild('export { value } from "./x.js";');
    withScript(reexport, (filePath) => {
      assert.throws(() => assertSelfContainedScript(filePath), /ESM/);
    });
  });
});

it('requires module loading for packaged Firefox background imports', () => {
  withScript('import "./shared.js";', filePath => {
    const dir = path.dirname(filePath);
    const manifest = path.join(dir, 'manifest.json');
    writeFileSync(manifest, JSON.stringify({ background: { scripts: ['content.js'] } }));
    assert.throws(() => assertBackgroundScriptLoading(dir), /ESM/);
    writeFileSync(manifest, JSON.stringify({ background: { scripts: ['content.js'], type: 'module' } }));
    assert.doesNotThrow(() => assertBackgroundScriptLoading(dir));
  });
});
