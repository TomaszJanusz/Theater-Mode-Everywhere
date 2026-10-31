import { createRequire } from 'node:module';
import path from 'node:path';

import type { Frame, Page } from 'playwright';

import { installChromeStub } from './chrome-stub';
import { readStylesheet } from './styles';

// Small pieces that start the shipped player on a fixture page. `bootPlayer` only
// composes them in the extension's order. A test that needs more calls the pieces
// itself; do not grow `bootPlayer` with options.

const esbuild = createRequire(import.meta.url)('esbuild') as {
  buildSync(options: object): { outputFiles: Array<{ text: string }> };
};
const SRC = new URL('../', import.meta.url).pathname;
const bundles = new Map<string, string>();

/**
 * One IIFE of `export … from './<path under src>'` lines, exposed as `globalName`.
 * Cached for the process per entry set, so a file builds each distinct bundle once.
 */
export function bundleModules(exports: readonly string[], globalName = 'TheaterTest'): string {
  const contents = exports.join('\n');
  const key = `${globalName}\n${contents}`;
  const cached = bundles.get(key);
  if (cached !== undefined) return cached;
  const text = esbuild.buildSync({
    stdin: { contents, resolveDir: SRC, loader: 'ts' },
    bundle: true, write: false, format: 'iife', globalName, platform: 'browser', target: 'es2022', logLevel: 'silent'
  }).outputFiles[0].text;
  bundles.set(key, text);
  return text;
}

/**
 * First lines of a runtime bundle: the fixture runtimes, then provider entries in both worlds, so its hooks register
 * before any runtime code runs, as the manifest orders runtime, provider and start. Both worlds share one registry in
 * a fixture; on other hosts the registration is rejected, as it is there.
 */
export const PROVIDER_ENTRIES = ["import './test-utils/fixture-runtimes';", "import './providers/youtube/isolated';",
  "import './providers/youtube/main';", "import './providers/viki/isolated';", "import './providers/viki/main';",
  "import './providers/twitch/isolated';", "import './providers/twitch/main';",
  "import './providers/bilibili/isolated';", "import './providers/bilibili/main';", "import './providers/bilibiliIntl/isolated';",
  "import './providers/bilibiliIntl/main';", "import './providers/disney/isolated';", "import './providers/disney/audio-main-entry';"] as const;

/** The player runtime and MAIN-world runtime as global `TheaterTest`, plus extra export lines a test inspects. */
export function bundlePlayer(extraExports: readonly string[] = []): string {
  return bundleModules([
    ...PROVIDER_ENTRIES,
    "export { bootstrapPlayerRuntime } from './ui/player-runtime';",
    "export { setPlayerUiCss } from './ui/root';",
    "export { installMainWorldRuntime } from './platform/main-world-runtime';",
    ...extraExports
  ]);
}

let sheets: { page: string; ui: string } | undefined;

/** `content.css` for the page and `shadow.css` for the player's shadow root, read once per process. */
export function playerStylesheets(): { page: string; ui: string } {
  sheets ??= { page: readStylesheet(path.join(SRC, 'content.css')), ui: readStylesheet(path.join(SRC, 'ui/shadow.css')) };
  return sheets;
}

export interface BootPlayerOptions {
  /** `chrome.storage.sync` contents. */
  settings?: Record<string, unknown>;
  /** Also install the MAIN-world runtime (volume boost and other page-side hooks). */
  mainWorld?: boolean;
  /** Replaces {@link bundlePlayer}`()`, e.g. with extra exports. */
  bundle?: string;
}

/**
 * Stub, page stylesheet, bundle, UI stylesheet, bootstrap — on an already navigated page.
 * Waiting for media and {@link enterTheater} stay with the test.
 */
export async function bootPlayer(page: Page | Frame, { settings = {}, mainWorld = false, bundle = bundlePlayer() }: BootPlayerOptions = {}): Promise<void> {
  const styles = playerStylesheets();
  await installChromeStub(page, { sync: settings });
  // tsx wraps named functions in __name(); serialized page callbacks need it defined.
  await page.addScriptTag({ content: 'window.__name = (fn) => fn;' });
  await page.addStyleTag({ content: styles.page });
  await page.addScriptTag({ content: bundle });
  if (mainWorld) await page.evaluate('TheaterTest.installMainWorldRuntime();');
  await page.evaluate(`TheaterTest.setPlayerUiCss(${JSON.stringify(styles.ui)}); TheaterTest.bootstrapPlayerRuntime();`);
}

/** Presses the theater key and waits for the control bar to show. */
export async function enterTheater(page: Page): Promise<void> {
  await page.keyboard.press('t');
  await page.locator('.theater-controls-wrapper.visible').waitFor();
}
