import * as fs from 'fs';
import * as path from 'path';

const ESM_IMPORT_RE = /\bimport\s*(?:['"]|\{|\w+\s+from\b)/;

export function assertSelfContainedScript(filePath: string): void {
  const source = fs.readFileSync(filePath, 'utf8');
  if (ESM_IMPORT_RE.test(source)) {
    throw new Error(`${path.basename(filePath)} contains ESM imports; MV3 content/MAIN scripts must stay self-contained.`);
  }
}

export function assertSelfContainedBundles(dir: string): void {
  for (const name of ['content.js', 'mainWorld.js'] as const) {
    assertSelfContainedScript(path.join(dir, name));
  }
}
