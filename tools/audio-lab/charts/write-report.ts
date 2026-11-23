import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { LabRun } from '../types';

import { renderReport } from './page';

const PANELS = ['spectrogram', 'waveform', 'reverb-tail', 'metrics'];

export async function writeReport(run: LabRun, outDir: string): Promise<void> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 900 },
      deviceScaleFactor: 1,
      colorScheme: 'light',
      locale: 'en-US',
    });
    const html = renderReport(run);
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await mkdir(outDir, { recursive: true });
    for (const id of PANELS) {
      await page.locator(`#${id}`).screenshot({ path: join(outDir, `${id}.png`), animations: 'disabled' });
    }
    await writeFile(join(outDir, 'index.html'), html);
  } finally {
    await browser.close();
  }
}
