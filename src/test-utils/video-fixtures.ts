import { readFileSync } from 'node:fs';
import type { Page } from 'playwright';

const PAGE_CSS = 'body { margin:0; background:#111; } video { width:960px; height:540px; }';
const document = (pageTitle: string, video: string, script = '') =>
  `<!doctype html><html><head><title>${pageTitle}</title><style>${PAGE_CSS}</style></head><body>${video}${script}</body></html>`;

export interface FixtureTitles { title: string; pageTitle?: string }

/** A muted video playing a canvas capture stream: always has frames, no media file. */
export function canvasVideoFixture({ title, pageTitle = title }: FixtureTitles): string {
  return document(pageTitle, `<video id="player" title="${title}" muted playsinline></video>`, `<script>
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1c2634'; ctx.fillRect(0, 0, 1280, 720);
    const video = document.querySelector('video');
    video.srcObject = canvas.captureStream(12);
    setInterval(() => { ctx.fillRect(0, 0, 1, 1); }, 100);
    video.play();
  </script>`);
}

let vod: string | undefined;

/** A paused video with the short seekable `test/fixtures/vod.webm` clip inlined. */
export function vodVideoFixture({ title, pageTitle = title }: FixtureTitles): string {
  vod ??= readFileSync(new URL('../../test/fixtures/vod.webm', import.meta.url)).toString('base64');
  return document(pageTitle, `<video id="player" title="${title}" muted playsinline src="data:video/webm;base64,${vod}"></video>`);
}

/** Serves `html` at `url` and opens it; the page's origin is what host-keyed settings see. */
export async function serveFixture(page: Page, html: string, url = 'http://player-boot.test/'): Promise<void> {
  await page.route(`${new URL(url).origin}/**`, route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(url);
}
