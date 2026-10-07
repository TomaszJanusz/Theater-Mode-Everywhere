import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Load the same local stylesheet graph used by Vite into browser fixtures. */
export function readStylesheet(file: string | URL): string {
  const filename = file instanceof URL ? fileURLToPath(file) : file;
  return readFileSync(filename, 'utf8').replace(
    /^\s*@import\s+['"]([^'"]+)['"]\s*;/gm,
    (_rule, relative: string) => readStylesheet(path.resolve(path.dirname(filename), relative))
  );
}
