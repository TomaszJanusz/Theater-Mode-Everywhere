import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { decodeRun } from '../run-json';

import { writeReport } from './write-report';

async function main([input, flag, dir, ...extra]: string[]): Promise<void> {
  if (!input || flag !== '--out' || !dir || extra.length) {
    throw new Error('Usage: pnpm audio:report <run.json> --out <dir>');
  }
  const outDir = resolve(dir);
  const run = decodeRun(await readFile(input, 'utf8'));
  await writeReport(run, outDir);
  console.log(`Wrote ${outDir}/index.html and four PNG panels`);
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`audio:report: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
