import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { openStory, selectTimeline } from '../.storybook/browser-navigation';
import { profilesFor, type Profile } from '../.storybook/profiles';
import { serveStorybook } from '../.storybook/static-server';

// Component-fixture captures from shared environment/content/viewport profiles, using production CSS.
// Timer moments and held WAAPI fractions establish rendering, not frame pacing or host behavior.
// manifest.json records PNG hashes; coverage.json records requested and effective capture inputs.
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
  rendered?: { locale?: string; direction?: string; motion?: string; viewport: number };
  animated: boolean;
  out: string;
  hashes: Record<string, string>;
  failures: string[];
}

function shotName(target: ShotTarget, frame: number | undefined): string {
  const { id, profile, effective } = target;
  const argsHash = createHash('sha256').update(JSON.stringify(effective?.args ?? {})).digest('hex').slice(0, 12);
  const held = frame === undefined ? '' : `.p${String(Math.round(frame * 100)).padStart(3, '0')}`;
  const { locale, backdrop, reduceMotion, timeline } = profile.globals;
  return `${id}.${profile.name}.${locale}.${backdrop}.motion-${reduceMotion}.time-${timeline}.${profile.viewport.width}x${profile.viewport.height}.os-${profile.reducedMotion}.args-${argsHash}${held}.png`;
}

/** Waits two frames so style, transitions started by the story and the compositor have caught up. */
function settleFrames(page: Page): Promise<void> {
  return page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

/** Holds every animation at `frame` and waits for the held state to be painted. */
async function holdFrame(page: Page, frame: number): Promise<number | undefined> {
  await page.evaluate(progress => window.__storyFrame?.(progress), frame);
  await settleFrames(page);
  // Layout observers can start another animation; pin again after their queued work settles.
  const held = await page.evaluate(progress => window.__storyFrame?.(progress), frame);
  await settleFrames(page);
  return held;
}

async function readCaptureState(page: Page, target: ShotTarget): Promise<void> {
  target.effective = await page.evaluate(() => window.__storyState);
  for (const [key, value] of Object.entries(target.profile.globals)) {
    if (target.effective?.globals[key] !== value) throw new Error(`${target.id}: global ${key} was pinned`);
  }
  for (const [key, value] of Object.entries(target.profile.args)) {
    if (target.effective?.args[key] !== value) throw new Error(`${target.id}: requested arg ${key} was not applied`);
  }
  target.rendered = await page.evaluate(() => {
    const host = document.getElementById('theater-everywhere-ui');
    return { locale: host?.lang, direction: host?.dir, motion: host?.dataset.motion, viewport: window.innerWidth };
  });
  const { locale, reduceMotion } = target.profile.globals;
  const expectedMotion = reduceMotion === 'on' || (reduceMotion === 'auto' && target.profile.reducedMotion === 'reduce') ? 'reduced' : 'normal';
  if (target.rendered.locale !== locale || target.rendered.direction !== (locale === 'ar' ? 'rtl' : 'ltr')
    || target.rendered.motion !== expectedMotion || target.rendered.viewport !== target.profile.viewport.width) {
    throw new Error(`${target.id}: requested environment did not reach the rendered root`);
  }
}

/** One PNG per story state; animated stories get one per held frame, a still story one. */
async function shootStory(page: Page, address: string, target: ShotTarget): Promise<void> {
  await openStory(page, address, target.id, target.profile);
  await page.evaluate(() => document.fonts.ready);
  await settleFrames(page);
  const frames = target.animated ? target.profile.frames ?? await page.evaluate(() => window.__storyFrames) ?? FRAMES : [undefined];
  const moments = target.profile.moments ?? frames.map(frame => ({ timeline: target.profile.globals.timeline, frame }));
  for (const { timeline, frame } of moments) {
    if (target.profile.moments) await selectTimeline(page, timeline);
    target.profile = { ...target.profile, globals: { ...target.profile.globals, timeline } };
    await readCaptureState(page, target);
    if (frame !== undefined && await holdFrame(page, frame) === undefined) {
      target.failures.push(`${target.id} (${target.profile.name}): no __storyFrame`);
    }
    const name = shotName(target, frame);
    // Held frames must not be fast-forwarded to their end state by the screenshot itself.
    const png = await page.screenshot({ animations: target.animated ? 'allow' : 'disabled', caret: 'hide', path: join(target.out, name) });
    target.hashes[name] = createHash('sha256').update(png).digest('hex');
    target.captures[name] = { story: target.id, profile: target.profile, effective: target.effective, rendered: target.rendered, frame, sha256: target.hashes[name] };
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
      for (const profile of profilesFor(story.id, engine)) await shootStory(page, url, {
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
