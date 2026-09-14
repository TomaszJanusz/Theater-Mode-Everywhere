import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { assertSelfContainedScript } from './bundle-integrity';

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
      'export { foo } from "./x.js";'
    ];
    for (const source of samples) {
      withScript(source, (filePath) => {
        assert.throws(() => assertSelfContainedScript(filePath), /ESM/);
      });
    }
  });
});
