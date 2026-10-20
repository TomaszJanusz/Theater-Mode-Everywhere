import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

// One deterministic PNG per story and backdrop, for `gh pr create|edit|comment --attach`.
// Fixed viewport, no animation or motion, bundled Roboto (see .storybook/preview.css).
const ROOT = resolve(import.meta.dirname, '..');
const STATIC_DIR = join(ROOT, 'output/storybook-static');
const SHOTS_DIR = join(ROOT, 'output/storybook-shots');
const VIEWPORT = { width: 640, height: 360 };
const BACKDROPS = ['dark', 'light'] as const;
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff'
};

interface IndexEntry { id: string; type: string }

async function serve(): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'https://localhost').pathname));
    const file = join(STATIC_DIR, path);
    if (!file.startsWith(STATIC_DIR)) {
      response.writeHead(403).end();
      return;
    }
    readFile(file).then(body => {
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
    }, () => response.writeHead(404).end());
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Static server did not bind a port');
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise(done => server.close(() => done())) };
}

async function main(): Promise<void> {
  const engine = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
  const out = join(SHOTS_DIR, engine);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const { url, close } = await serve();
  const browser = await (await import('playwright'))[engine].launch();
  const hashes: Record<string, string> = {};
  try {
    const index = JSON.parse(await readFile(join(STATIC_DIR, 'index.json'), 'utf8')) as { entries: Record<string, IndexEntry> };
    const ids = Object.values(index.entries).filter(entry => entry.type === 'story').map(entry => entry.id).sort();
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const failures: string[] = [];
    for (const id of ids) {
      for (const backdrop of BACKDROPS) {
        await page.goto(`${url}/iframe.html?id=${id}&viewMode=story&globals=backdrop:${backdrop}`);
        // The play function has run to the end; an error leaves the preview in `errored`.
        const phase = await page.waitForFunction(() => {
          const phase = (window as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } })
            .__STORYBOOK_PREVIEW__?.currentRender?.phase;
          return phase === 'finished' || phase === 'errored' || phase === 'aborted' ? phase : false;
        }).then(handle => handle.jsonValue());
        if (phase !== 'finished') failures.push(`${id} (${backdrop}): ${phase}`);
        await page.evaluate(() => document.fonts.ready);
        const name = `${id}.${backdrop}.png`;
        const png = await page.screenshot({ animations: 'disabled', caret: 'hide', path: join(out, name) });
        hashes[name] = createHash('sha256').update(png).digest('hex');
      }
    }
    await writeFile(join(out, 'manifest.json'), `${JSON.stringify(hashes, null, 2)}\n`);
    console.log(`${Object.keys(hashes).length} screenshots in ${out}`);
    if (failures.length > 0) throw new Error(`Stories did not finish rendering:\n${failures.join('\n')}`);
  } finally {
    await browser.close();
    await close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
