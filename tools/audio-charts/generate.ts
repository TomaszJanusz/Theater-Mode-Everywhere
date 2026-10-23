import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { openAudioRenderer } from '../../src/test-utils/audio-render';

import { renderPage } from './page';
import { measureEffects } from './spectra';

/** `pnpm audio:charts [output-dir]` writes index.html with a before/after spectrum per audio effect. */
async function main(): Promise<void> {
  const outDir = path.resolve(process.argv[2] ?? 'output/audio-charts');
  const renderer = await openAudioRenderer();
  if (!renderer) throw new Error('Chromium is not installed; run `pnpm exec playwright install chromium`.');
  try {
    const panels = await measureEffects(renderer.render);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'index.html'), renderPage(panels));
    for (const panel of panels) {
      for (const point of panel.points) {
        const after = panel.variants.map((v) => v + ' ' + point.after[v].toFixed(1)).join(', ');
        console.log(`${panel.id} ${point.hz} Hz: ${point.before.toFixed(1)} dB -> ${after}`);
      }
    }
    console.log(`wrote ${path.join(outDir, 'index.html')}`);
  } finally {
    await renderer.browser.close();
  }
}

void main();
