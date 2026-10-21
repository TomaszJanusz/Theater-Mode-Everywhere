import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { profilesFor, storyUrl, type Profile } from '../.storybook/profiles';
import { serveStorybook } from '../.storybook/static-server';

// One deterministic PNG per story and backdrop, for `gh pr create|edit|comment --attach`.
// Fixed viewport, no animation or motion, bundled Roboto (see .storybook/preview.css).
// Stories tagged `frames` are animated: each is shot with every animation held at fixed fractions of its
// first iteration (`window.__storyFrame`, see .storybook/hud-stage.ts). Tags `no-shot` and `live` are skipped.
const ROOT = resolve(import.meta.dirname, '..');
const STATIC_DIR = join(ROOT, 'output/storybook-static');
const SHOTS_DIR = join(ROOT, 'output/storybook-shots');
const FRAMES = [0, 0.5, 1] as const;
interface IndexEntry { id: string; type: string; tags?: string[] }

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
  profile: Profile;
  effective?: { globals: Record<string, unknown>; args: Record<string, unknown> };
  captures: Record<string, unknown>;
  animated: boolean;
  out: string;
  hashes: Record<string, string>;
  failures: string[];
}

function shotName(target: ShotTarget, frame: number | undefined): string {
  const { id, profile, effective } = target;
  const argsHash = createHash('sha256').update(JSON.stringify(effective?.args ?? {})).digest('hex').slice(0, 12);
  const held = frame === undefined ? '' : `.p${String(Math.round(frame * 100)).padStart(3, '0')}`;
  const { locale, backdrop, reduceMotion } = profile.globals;
  return `${id}.${profile.name}.${locale}.${backdrop}.motion-${reduceMotion}.${profile.viewport.width}x${profile.viewport.height}.os-${profile.reducedMotion}.args-${argsHash}${held}.png`;
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
  await page.setViewportSize(target.profile.viewport);
  await page.emulateMedia({ reducedMotion: target.profile.reducedMotion });
  await page.goto(address);
  const phase = await renderedPhase(page);
  if (phase !== 'finished') target.failures.push(`${target.id} (${target.profile.name}): ${String(phase)}`);
  target.effective = await page.evaluate(() => window.__storyState);
  for (const [key, value] of Object.entries(target.profile.globals)) {
    if (target.effective?.globals[key] !== value) throw new Error(`${target.id}: global ${key} was pinned`);
  }
  await page.evaluate(() => document.fonts.ready);
  await settleFrames(page);
  const frames = target.profile.frames ?? (target.animated ? await page.evaluate(() => window.__storyFrames) ?? FRAMES : [undefined]);
  for (const frame of frames) {
    if (frame !== undefined && await holdFrame(page, frame) === undefined) {
      target.failures.push(`${target.id} (${target.profile.name}): no __storyFrame`);
    }
    const name = shotName(target, frame);
    // Held frames must not be fast-forwarded to their end state by the screenshot itself.
    const png = await page.screenshot({ animations: target.animated ? 'allow' : 'disabled', caret: 'hide', path: join(target.out, name) });
    target.hashes[name] = createHash('sha256').update(png).digest('hex');
    target.captures[name] = { story: target.id, profile: target.profile, effective: target.effective, frame, sha256: target.hashes[name] };
  }
}

async function main(): Promise<void> {
  const started = performance.now();
  const engine = process.argv[2] === 'firefox' ? 'firefox' : 'chromium';
  const out = join(SHOTS_DIR, engine);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  const { url, close } = await serveStorybook();
  const browser = await launch(engine);
  const hashes: Record<string, string> = {};
  const captures: Record<string, unknown> = {};
  try {
    const index = JSON.parse(await readFile(join(STATIC_DIR, 'index.json'), 'utf8')) as { entries: Record<string, IndexEntry> };
    const stories = Object.values(index.entries)
      .filter(entry => entry.type === 'story' && !entry.tags?.some(tag => tag === 'no-shot' || tag === 'live'))
      .sort((a, b) => a.id.localeCompare(b.id));
    const context = await browser.newContext({ deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const failures: string[] = [];
    for (const story of stories) {
      for (const profile of profilesFor(story.id)) await shootStory(page, storyUrl(url, story.id, profile), {
        id: story.id, profile, captures, animated: story.tags?.includes('frames') ?? false, out, hashes, failures
      });
    }
    await writeFile(join(out, 'manifest.json'), `${JSON.stringify(hashes, null, 2)}\n`);
    await writeFile(join(out, 'coverage.json'), `${JSON.stringify(captures, null, 2)}\n`);
    console.log(`${Object.keys(hashes).length} screenshots; ${new Set(Object.values(hashes)).size} unique hashes; ${((performance.now() - started) / 1000).toFixed(2)}s capture wall time in ${out}`);
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
