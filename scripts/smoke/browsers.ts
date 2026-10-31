import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { chromium, firefox, type BrowserContext, type Page } from 'playwright';

import { assertAppearanceModes } from './appearance';
import { assertAudioWorld } from './audio';
import { assertAutoTheater } from './auto-theater';
import { assertBilibiliProvider, assertBilibiliTvProvider } from './bilibili-providers';
import { assertDisneyProvider } from './disney';
import { FirefoxRemote } from './firefox-rdp';
import { assertFreshInstall } from './first-run-setup';
import { assertEmbeddedKeysAndFullscreen } from './frames';
import { injectBundledPlayer, setFirefoxBackground, theaterEntered, timeScenario, extensionWorker, type ExtensionBackground, PLAYER_FIXTURE, IFRAME_FIXTURE, YOUTUBE_EMBED_FIXTURE, VOD_FIXTURE, fail, skipLocally, playwrightExecutable, requestedBrowsers, requireBuiltExtension, startFixtureServer, waitForPlayer, setBlacklist, useSyncQuota } from './helpers';
import { assertNetflixAudio } from './netflix-audio';
import { assertPinStorage } from './pin-storage';
import { assertPatreonProvider, assertProviderScripts, assertIqiyiProvider, assertTwitchProvider, assertVimeoProvider, assertYoutubeProvider } from './providers';
import { assertRteSettings, assertPictureLayout } from './settings';
import type { QuotaClock } from './sync-quota';
import { installSyncQuota } from './sync-quota-guard';
import { assertBadgeAfterRestart, assertUpdateNotice } from './update-notice';
import { assertVikiProvider } from './viki-provider';

interface EntryScenarios {
  assertShortcutManagement(page: Page, context: BrowserContext): Promise<void>;
  assertBlacklistBlocksTheater(page: Page): Promise<void>;
  assertIframeHandshake(page: Page, origin: string): Promise<void>;
  assertParentBlacklist(page: Page, origin: string, context: BrowserContext): Promise<void>;
  assertLanguageMenu(page: Page, origin: string, context: BrowserContext): Promise<void>;
}
/** Their bodies predate `timeScenario`; wrapping them here gives each a timing row and a sync-write budget. */
const PROVIDER_SCENARIOS: ReadonlyArray<{ name: string; syncWrites: number; run: (page: Page, context: BrowserContext) => Promise<void> }> = [
  { name: 'assertProviderScripts', syncWrites: 7, run: assertProviderScripts },
  { name: 'assertPatreonProvider', syncWrites: 7, run: assertPatreonProvider },
  { name: 'assertVimeoProvider', syncWrites: 7, run: assertVimeoProvider },
  { name: 'assertIqiyiProvider', syncWrites: 7, run: assertIqiyiProvider },
  { name: 'assertBilibiliProvider', syncWrites: 11, run: assertBilibiliProvider },
  { name: 'assertBilibiliTvProvider', syncWrites: 7, run: assertBilibiliTvProvider },
  { name: 'assertYoutubeProvider', syncWrites: 4, run: assertYoutubeProvider },
  { name: 'assertTwitchProvider', syncWrites: 7, run: assertTwitchProvider },
  { name: 'assertDisneyProvider', syncWrites: 3, run: assertDisneyProvider },
  { name: 'assertVikiProvider', syncWrites: 7, run: assertVikiProvider },
  { name: 'assertNetflixAudio', syncWrites: 5, run: assertNetflixAudio }
];

async function runProviderScenarios(page: Page, context: BrowserContext): Promise<void> {
  for (const { name, syncWrites, run } of PROVIDER_SCENARIOS) {
    await timeScenario(name, { syncWrites }, () => run(page, context));
  }
}

/** The built extension in a fresh Chromium profile; extra arguments go before the extension's. */
function launchChromiumExtension(userDataDir: string, unpackedDir: string, args: string[] = []): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 720 },
    args: [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      ...args,
      `--disable-extensions-except=${unpackedDir}`,
      `--load-extension=${unpackedDir}`
    ]
  });
}

async function smokeChromium(origin: string, unpackedDir: string, scenarios: EntryScenarios, clock: QuotaClock): Promise<void> {
  if (!playwrightExecutable('chromium')) {
    skipLocally('Skipping smoke:chromium. Run: pnpm exec playwright install chromium firefox');
  }
  // A browser and profile of its own, started once the shared one has closed.
  if (await smokeSharedChromium(origin, unpackedDir, scenarios, clock)) {
    await assertBadgeAfterRestart(unpackedDir, launchChromiumExtension);
    await assertFreshInstall(unpackedDir, launchChromiumExtension);
  }
}

/** Resolves whether the run covers the update notice, so the restart check follows it. */
async function smokeSharedChromium(origin: string, unpackedDir: string, scenarios: EntryScenarios, clock: QuotaClock): Promise<boolean> {
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'te-smoke-chromium-'));
  let context: BrowserContext | null = null;
  try {
    context = await launchChromiumExtension(userDataDir, unpackedDir,
      ['--host-resolver-rules=MAP *.example.localhost 127.0.0.1,MAP example.localhost 127.0.0.1']);

    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    useSyncQuota(await installSyncQuota(context, clock));
    // Escape is always an exit alias, including with a remapped exit shortcut.
    await worker.evaluate(() => chrome.storage.sync.set({ shortcuts: { exit: 'X' } }));

    const page = context.pages()[0] || await context.newPage();
    if (process.env.THEATER_SMOKE_PROVIDERS_ONLY === '1') {
      await runProviderScenarios(page, context);
      return false;
    }
    if (process.env.THEATER_SMOKE_UPDATE_ONLY === '1') {
      await assertUpdateNotice(page, origin, context, 'chromium');
      return true;
    }
    if (process.env.THEATER_SMOKE_APPEARANCE_ONLY === '1') {
      await assertAppearanceModes(context, origin);
      return false;
    }
    if (process.env.THEATER_SMOKE_LANGUAGE_ONLY === '1') {
      await scenarios.assertLanguageMenu(page, origin, context);
      return false;
    }
    if (process.env.THEATER_SMOKE_AUTO_THEATER_ONLY === '1') {
      await assertAutoTheater(page, context);
      return false;
    }
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await assertInstalledStartup(page);
    // A new document isolates independent entry scenarios from T's 200 ms repeat guard.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await assertAudioWorld(page, context);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    if (process.env.THEATER_SMOKE_SHORTCUTS_ONLY !== '1') await assertPinStorage(page, context);
    await scenarios.assertShortcutManagement(page, context);
    await assertRteSettings(context);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await page.locator('video#player').click();
    await page.keyboard.press('t');
    await page.locator('.theater-controls-wrapper').waitFor();
    await assertPictureLayout(page, context);
    await page.keyboard.press('Escape');
    await setBlacklist(context, ['127.0.0.1']);
    await scenarios.assertBlacklistBlocksTheater(page);
    await setBlacklist(context, []);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await assertInstalledStartup(page);
    console.log('smoke:chromium blacklist exact host passed');

    await scenarios.assertIframeHandshake(page, origin);
    console.log('smoke:chromium same-origin iframe handshake passed');
    await assertEmbeddedKeysAndFullscreen(page, origin);
    console.log('smoke:chromium host-claimed keys and embedded fullscreen ownership passed');

    await assertAutoTheater(page, context);
    await runProviderScenarios(page, context);
    await scenarios.assertParentBlacklist(page, origin, context);
    await setBlacklist(context, []);
    console.log('smoke:chromium parent-domain blacklist passed');
    await scenarios.assertLanguageMenu(page, origin, context);
    await assertUpdateNotice(page, origin, context, 'chromium');
    await assertAppearanceModes(context, origin);
    return true;
  } finally {
    useSyncQuota(null);
    await context?.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
}
// Firefox's browser-owned hover PiP widget intercepts clicks above page overlays.
// Exercise extension UI independently of that native browser widget.
const NO_PIP = { 'media.videocontrols.picture-in-picture.video-toggle.enabled': false };
const VIEWPORT = { width: 1280, height: 720 };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(error => (error ? reject(error) : resolve(port)));
    });
  });
}

/** Evaluates in the background page over RDP; results travel as JSON so values round-trip like Playwright's. */
function backgroundOver(remote: FirefoxRemote, consoleActor: string, origin: string): ExtensionBackground {
  return {
    url: () => `${origin}_generated_background_page.html`,
    async evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R> {
      const call = `(${fn})(${arg === undefined ? '' : JSON.stringify(arg)})`;
      const json = await remote.evaluateString(consoleActor, `(async () => JSON.stringify({ value: await ${call} }))()`);
      return (JSON.parse(json) as { value: R }).value;
    }
  };
}

/** Loads the built extension as a temporary add-on over Firefox's remote debugging protocol, as `web-ext run` does. */
async function installedFirefox(userDataDir: string, unpackedDir: string): Promise<{ context: BrowserContext; remote: FirefoxRemote }> {
  const port = await freePort();
  const context = await firefox.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: VIEWPORT,
    args: ['-start-debugger-server', String(port)],
    firefoxUserPrefs: {
      ...NO_PIP,
      'devtools.debugger.remote-enabled': true,
      'devtools.debugger.prompt-connection': false,
      // The event page must outlive idle gaps between scenarios; the debugger evaluates inside it.
      'extensions.background.idle.timeout': 3_600_000
    }
  });
  try {
    const remote = await FirefoxRemote.connect(port);
    try {
      const addonId = await remote.installTemporaryAddon(unpackedDir);
      const { consoleActor, origin } = await remote.background(addonId);
      setFirefoxBackground(context, backgroundOver(remote, consoleActor, origin));
      return { context, remote };
    } catch (error) {
      remote.close();
      throw error;
    }
  } catch (error) {
    await context.close();
    throw error;
  }
}

/** Local diagnostic only (`THEATER_SMOKE_FIREFOX_INJECT=1`): runs the bundles as page scripts, with no extension installed. */
async function smokeInjectedBundles(origin: string, unpackedDir: string): Promise<void> {
  const browser = await firefox.launch({ headless: true, firefoxUserPrefs: NO_PIP });
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    page.on('pageerror', (error) => console.warn('Firefox page error:', error.message));
    page.on('console', (message) => { if (message.type() === 'error') console.warn('Firefox console:', message.text()); });
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await injectBundledPlayer(page, unpackedDir);
    await assertInstalledStartup(page);
    console.log('smoke:firefox DIAGNOSTIC ONLY passed (injected bundles; no extension installed, so permissions, background and storage are not covered)');
  } finally {
    await browser.close();
  }
}

async function smokeFirefox(origin: string, unpackedDir: string, scenarios: EntryScenarios): Promise<void> {
  if (!playwrightExecutable('firefox')) {
    skipLocally('Skipping smoke:firefox. Run: pnpm exec playwright install chromium firefox');
  }
  if (process.env.THEATER_SMOKE_FIREFOX_INJECT === '1') return smokeInjectedBundles(origin, unpackedDir);

  const userDataDir = mkdtempSync(path.join(tmpdir(), 'te-smoke-firefox-'));
  let installed: Awaited<ReturnType<typeof installedFirefox>> | null = null;
  try {
    installed = await installedFirefox(userDataDir, unpackedDir);
    const { context } = installed;
    const page = context.pages()[0] || await context.newPage();
    if (process.env.THEATER_SMOKE_PROVIDERS_ONLY === '1') {
      await runProviderScenarios(page, context);
      return;
    }
    page.on('pageerror', (error) => console.warn('Firefox page error:', error.message));
    if (process.env.THEATER_SMOKE_UPDATE_ONLY === '1') {
      await assertUpdateNotice(page, origin, context, 'firefox');
      return;
    }
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await assertInstalledStartup(page);
    console.log('smoke:firefox installed extension startup passed');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await assertStorageWorlds(page, context);
    console.log('smoke:firefox background storage reaches isolated and MAIN worlds');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForPlayer(page);
    await assertAudioWorld(page, context);
    console.log('smoke:firefox installed audio graph and storage passed');
    await setBlacklist(context, ['127.0.0.1']);
    await scenarios.assertBlacklistBlocksTheater(page);
    await setBlacklist(context, []);
    console.log('smoke:firefox blacklist exact host passed');
    await scenarios.assertIframeHandshake(page, origin);
    console.log('smoke:firefox same-origin iframe handshake passed');
    await assertEmbeddedKeysAndFullscreen(page, origin);
    console.log('smoke:firefox host-claimed keys and embedded fullscreen ownership passed');
    await runProviderScenarios(page, context);
    await scenarios.assertParentBlacklist(page, origin, context);
    await setBlacklist(context, []);
    console.log('smoke:firefox parent-domain blacklist passed');
    await assertUpdateNotice(page, origin, context, 'firefox');
  } finally {
    installed?.remote.close();
    await installed?.context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

export async function runBrowsers(scenarios: EntryScenarios, clock: QuotaClock): Promise<void> {
  if (!existsSync(PLAYER_FIXTURE) || !existsSync(IFRAME_FIXTURE) || !existsSync(YOUTUBE_EMBED_FIXTURE) || !existsSync(VOD_FIXTURE)) {
    fail('Missing smoke fixtures under test/fixtures.');
  }

  const fullStart = performance.now();
  const targets = requestedBrowsers();
  const fixture = await startFixtureServer();
  try {
    for (const kind of targets) {
      const unpackedDir = requireBuiltExtension(kind);
      if (kind === 'chromium') await smokeChromium(fixture.origin, unpackedDir, scenarios, clock);
      else await smokeFirefox(fixture.origin, unpackedDir, scenarios);
    }
  } finally {
    await fixture.close();
    if (process.env.THEATER_SMOKE_TIMING === '1') console.log(`TOTAL ${((performance.now() - fullStart) / 1000).toFixed(3)}`);
  }
}

async function assertInstalledStartup(page: Page): Promise<void> {
  await timeScenario('assertInstalledStartup', { syncWrites: 0 }, async () => {
    await page.locator('video#player').click();
    await page.keyboard.press('t');
    await page.locator('.theater-controls-wrapper').waitFor();
    if (process.env.THEATER_SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.THEATER_SMOKE_SCREENSHOT });
    await page.keyboard.press('Escape');
    await page.locator('.theater-controls-wrapper').waitFor({ state: 'detached' });
  });
}

/**
 * Extension storage written in the background reaches the isolated content script, which publishes
 * the entry shortcuts that the MAIN-world script reads before the page can claim the key.
 */
async function assertStorageWorlds(page: Page, context: BrowserContext): Promise<void> {
  await timeScenario('assertStorageWorlds', { syncWrites: 2 }, async () => {
    const background = await extensionWorker(context);
    const published = (key: string) => page.waitForFunction(expected => document.documentElement.getAttribute('data-theater-everywhere-entry-shortcuts')?.includes(expected), key);
    try {
      await background.evaluate(() => chrome.storage.sync.set({ shortcuts: { toggle: 'Shift+T' } }));
      await published('"toggle":"Shift+T"');
      await page.locator('video#player').click();
      await page.keyboard.press('t');
      if (await theaterEntered(page)) fail('The replaced theater key still activates TME.');
      await page.keyboard.press('Shift+T');
      await page.locator('.theater-controls-wrapper').waitFor();
      await page.keyboard.press('Escape');
      await page.locator('.theater-controls-wrapper').waitFor({ state: 'detached' });
    } finally {
      await background.evaluate(() => chrome.storage.sync.remove('shortcuts'));
    }
    await published('"toggle":"T"');
  });
}
