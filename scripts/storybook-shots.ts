import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

// One deterministic PNG per story and backdrop, for `gh pr create|edit|comment --attach`.
// Fixed viewport, no animation or motion, bundled Roboto (see .storybook/preview.css).
// Stories tagged `frames` are animated: each is shot with every animation held at fixed fractions of its
// first iteration (`window.__storyFrame`, see .storybook/hud-stage.ts). Tags `no-shot` and `live` are skipped.
const ROOT = resolve(import.meta.dirname, '..');
const STATIC_DIR = join(ROOT, 'output/storybook-static');
const SHOTS_DIR = join(ROOT, 'output/storybook-shots');
const VIEWPORT = { width: 640, height: 360 };
const BACKDROPS = ['dark', 'light'] as const;
const FRAMES = [0, 0.5, 1] as const;
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff'
};

interface IndexEntry { id: string; type: string; tags?: string[] }

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

declare global {
  interface Window { __storyFrame?: (progress: number) => number; __storyFrames?: readonly number[] }
}

async function launch(engine: 'chromium' | 'firefox') {
  return (await import('playwright'))[engine].launch();
}
type Browser = Awaited<ReturnType<typeof launch>>;
type Page = Awaited<ReturnType<Awaited<ReturnType<Browser['newContext']>>['newPage']>>;

interface ShotTarget {
  id: string;
  backdrop: string;
  animated: boolean;
  out: string;
  hashes: Record<string, string>;
  failures: string[];
}

function shotName({ id, backdrop }: ShotTarget, frame: number | undefined): string {
  const held = frame === undefined ? '' : `.p${String(Math.round(frame * 100)).padStart(3, '0')}`;
  return `${id}${held}.${backdrop}.png`;
}

async function renderedPhase(page: Page): Promise<unknown> {
  // The play function has run to the end; an error leaves the preview in `errored`.
  return page.waitForFunction(() => {
    const phase = (window as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } })
      .__STORYBOOK_PREVIEW__?.currentRender?.phase;
    return phase === 'finished' || phase === 'errored' || phase === 'aborted' ? phase : false;
  }).then(handle => handle.jsonValue());
}

/** Waits two frames so style, transitions started by the story and the compositor have caught up. */
function settleFrames(page: Page): Promise<void> {
  return page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

/** Holds every animation at `frame` and waits for the held state to be painted. */
async function holdFrame(page: Page, frame: number): Promise<number | undefined> {
  const held = await page.evaluate(progress => window.__storyFrame?.(progress), frame);
  await settleFrames(page);
  return held;
}

/** One PNG per story state; animated stories get one per held frame, a still story one. */
async function shootStory(page: Page, address: string, target: ShotTarget): Promise<void> {
  await page.goto(address);
  const phase = await renderedPhase(page);
  if (phase !== 'finished') target.failures.push(`${target.id} (${target.backdrop}): ${String(phase)}`);
  await page.evaluate(() => document.fonts.ready);
  await settleFrames(page);
  const frames = target.animated ? await page.evaluate(() => window.__storyFrames) ?? FRAMES : [undefined];
  for (const frame of frames) {
    if (frame !== undefined && await holdFrame(page, frame) === undefined) {
      target.failures.push(`${target.id} (${target.backdrop}): no __storyFrame`);
    }
    const name = shotName(target, frame);
    // Held frames must not be fast-forwarded to their end state by the screenshot itself.
    const png = await page.screenshot({ animations: target.animated ? 'allow' : 'disabled', caret: 'hide', path: join(target.out, name) });
    target.hashes[name] = createHash('sha256').update(png).digest('hex');
  }
}

async function main(): Promise<void> {
  const engine = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
  const out = join(SHOTS_DIR, engine);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const { url, close } = await serve();
  const browser = await launch(engine);
  const hashes: Record<string, string> = {};
  try {
    const index = JSON.parse(await readFile(join(STATIC_DIR, 'index.json'), 'utf8')) as { entries: Record<string, IndexEntry> };
    const stories = Object.values(index.entries)
      .filter(entry => entry.type === 'story' && !entry.tags?.some(tag => tag === 'no-shot' || tag === 'live'))
      .sort((a, b) => a.id.localeCompare(b.id));
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const failures: string[] = [];
    for (const story of stories) {
      for (const backdrop of BACKDROPS) await shootStory(page, `${url}/iframe.html?id=${story.id}&viewMode=story&globals=backdrop:${backdrop}`, {
        id: story.id, backdrop, animated: story.tags?.includes('frames') ?? false, out, hashes, failures
      });
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
