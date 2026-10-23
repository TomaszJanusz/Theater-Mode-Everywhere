import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from 'playwright';

import type * as MediaAudioRuntime from '../platform/media-audio-runtime';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const esbuild = require(createRequire(require.resolve('vite')).resolve('esbuild')) as {
  buildSync(options: Record<string, unknown>): { outputFiles: Array<{ text: string }> };
};

/** The media audio runtime as a page script exposing `window.AudioRuntime`. */
export const AUDIO_RUNTIME_BUNDLE = esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'src/platform/media-audio-runtime.ts')],
  bundle: true, write: false, format: 'iife', globalName: 'AudioRuntime', platform: 'browser', target: 'es2022'
}).outputFiles[0].text;

export function fixtureDataUrl(file: 'vod.webm' | 'tone.webm'): string {
  return `data:video/webm;base64,${readFileSync(path.join(ROOT, 'test/fixtures', file)).toString('base64')}`;
}

export const WATCH_PAGE_URL = 'https://watch.example/';

/** Opens the watch page in theater state: one active video, one idle video and a gesture target. */
export async function openWatchPage(page: Page): Promise<void> {
  await page.addInitScript('window.__name = target => target;');
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  page.on('pageerror', error => console.error(error.message));
  await page.route(WATCH_PAGE_URL, route => route.fulfill({
    contentType: 'text/html',
    body: '<html class="theater-everywhere-html-active"><button id="gesture">Apply</button><video id="first" class="theater-everywhere-video-active"></video><video id="second"></video>'
  }));
  await page.goto(WATCH_PAGE_URL);
}

/** Loads both videos with `media`, then installs the runtime. Resolves once metadata is available. */
export async function installRuntime(page: Page, media: string): Promise<void> {
  await page.evaluate(media => {
    // Playwright evaluation itself can grant transient activation. Force
    // the deferred branch; trusted pointer/key events still activate it.
    Object.defineProperty(navigator, 'userActivation', { value: { isActive: false }, configurable: true });
    for (const video of document.querySelectorAll('video')) video.src = media;
  }, media);
  await page.waitForFunction(() => Array.from(document.querySelectorAll('video')).every(video => video.readyState >= 1));
  await page.addScriptTag({ content: AUDIO_RUNTIME_BUNDLE });
  await page.evaluate(() => window.AudioRuntime.installMediaAudioRuntime());
}

declare global {
  interface Window {
    AudioRuntime: typeof MediaAudioRuntime;
  }
}
