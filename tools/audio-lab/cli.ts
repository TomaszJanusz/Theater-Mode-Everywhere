import { writeFileSync } from 'node:fs';

import { LAB_EFFECTS } from './effects';
import { encodeRun } from './run-json';
import { runLab } from './run-lab';
import { SYNTHETIC_IDS } from './synthetic';
import { formatRun } from './table';

const USAGE = `Usage: pnpm audio:lab <effect> <material> [--json out.json]
  effect    ${LAB_EFFECTS.map(effect => effect.id).join(', ')}
  material  a corpus id (tools/audio-lab/corpus/manifest.json), a built-in id (${SYNTHETIC_IDS.join(', ')}) or a WAV file`;

async function main(args: string[]): Promise<void> {
  const at = args.indexOf('--json');
  const json = at >= 0 ? args[at + 1] : undefined;
  const [effect, material, ...rest] = at >= 0 ? [...args.slice(0, at), ...args.slice(at + 2)] : args;
  if (!effect || !material || rest.length > 0 || (at >= 0 && !json)) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const run = await runLab(effect, material);
  console.log(formatRun(run));
  if (json) {
    writeFileSync(json, encodeRun(run));
    console.log(`\nwrote ${json}`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
