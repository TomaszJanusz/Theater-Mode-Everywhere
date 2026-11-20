import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The echo-reduction DSP ships as a committed, reproducible WebAssembly binary. `pnpm build:wasm`
 * rewrites it from the AssemblyScript source; `pnpm build` only copies it; `pnpm verify:bundles`
 * (a CI gate) compiles the source again with the pinned assemblyscript and requires identical bytes,
 * so the committed file is always the output of the reviewed source. AMO reviewers rebuild it the same way.
 */
export const ECHO_DSP_SOURCE = 'assembly/echo-reduction.ts';
export const ECHO_DSP_BINARY = 'assembly/echo-reduction.wasm';
// The size-optimised SIMD build runs as fast as -O3 at half the bytes (TME-259, section 9.6).
// Both browser minimums (Chromium 114, Firefox 140) support WebAssembly SIMD, so there is no scalar build.
const FLAGS = ['-O3', '--shrinkLevel', '2', '--converge', '--runtime', 'stub', '--enable', 'simd', '--noAssert'];

export async function compileEchoDsp(root = process.cwd()): Promise<Uint8Array> {
  const asc = await import('assemblyscript/asc');
  let binary: Uint8Array | null = null;
  const { error, stderr } = await asc.main([ECHO_DSP_SOURCE, '--baseDir', root, '--outFile', 'echo-reduction.wasm', ...FLAGS], {
    readFile: (name, baseDir) => {
      try { return readFileSync(resolve(baseDir, name), 'utf8'); } catch { return null; }
    },
    writeFile: (name, contents) => {
      if (name.endsWith('.wasm') && typeof contents !== 'string') binary = contents;
    },
    listFiles: () => []
  });
  if (error) throw new Error(`AssemblyScript failed: ${error.message}\n${stderr.toString()}`);
  assert.ok(binary, 'AssemblyScript produced no binary');
  return binary;
}

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Rebuild-and-compare: the committed binary must be what the source compiles to. */
export async function assertDspReproducible(root = process.cwd()): Promise<void> {
  const rebuilt = sha256(await compileEchoDsp(root));
  const committed = sha256(readFileSync(resolve(root, ECHO_DSP_BINARY)));
  assert.equal(committed, rebuilt, `${ECHO_DSP_BINARY} is not the build of ${ECHO_DSP_SOURCE}; run pnpm build:wasm and commit the result`);
}

async function main(args: string[]): Promise<void> {
  if (args.includes('--check')) {
    await assertDspReproducible();
    console.log(`${ECHO_DSP_BINARY} matches its source.`);
    return;
  }
  const bytes = await compileEchoDsp();
  writeFileSync(ECHO_DSP_BINARY, bytes);
  console.log(`Wrote ${ECHO_DSP_BINARY}: ${bytes.length} B, sha256 ${sha256(bytes)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
