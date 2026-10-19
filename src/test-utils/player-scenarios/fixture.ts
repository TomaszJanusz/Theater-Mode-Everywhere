import type { TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import { sharedTestBrowser } from '../test-browser';
import { readStylesheet } from '../styles';
import { readCatalog } from '../language-audit';

const bundle = buildSync({
  stdin: { contents: "export { bootstrapPlayerRuntime } from './ui/player-runtime'; export { installMainWorldRuntime } from './platform/main-world-runtime'; export { languageRuntime } from './i18n-runtime'; export { setPlayerUiCss } from './ui/root';", resolveDir: new URL('../../', import.meta.url).pathname, loader: 'ts' },
  bundle: true, write: false, format: 'iife', globalName: 'SmokeRegressions', platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;
const fixture = readFileSync(new URL('../../../test/fixtures/local-player.html', import.meta.url), 'utf8');
const vod = readFileSync(new URL('../../../test/fixtures/vod.webm', import.meta.url));
const css = readStylesheet(new URL('../../content.css', import.meta.url));
const catalogs: Record<string, unknown> = { pl: readCatalog('pl'), ar: readCatalog('ar') };
const shadow = readStylesheet(new URL('../../ui/shadow.css', import.meta.url));

export async function playerFixture(shared: ReturnType<typeof sharedTestBrowser>, t: TestContext) {
  const context = await shared.newContext(t, { viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.route('http://smoke-regression.test/**', route => route.fulfill(route.request().url().endsWith('/vod.webm')
    ? { contentType: 'video/webm', body: vod } : { contentType: 'text/html', body: fixture }));
  await page.goto('http://smoke-regression.test/');
  await page.evaluate('window.__name = fn => fn;');
  await page.evaluate(catalogs => {
    const values: Record<string, unknown> = { shortcuts: { exit: 'X' } };
    type StorageListener = (changes: object, area: string) => void;
    const listeners = new Set<StorageListener>();
    const area = {
      get: async () => ({ ...values }),
      set: async (update: Record<string, unknown>) => {
        Object.assign(values, update);
        const changes = Object.fromEntries(Object.entries(update).map(([key, newValue]) => [key, { newValue }]));
        listeners.forEach(listener => listener(changes, 'sync'));
      }
    };
    Object.assign(window, { chrome: { runtime: {
      sendMessage: async (request: { action: string; locale: string }) => request.action === 'get-language-catalog' ? catalogs[request.locale] : undefined
    }, storage: { sync: area, local: area,
      onChanged: { addListener: (listener: StorageListener) => listeners.add(listener), removeListener: (listener: StorageListener) => listeners.delete(listener) }
    } } });
  }, catalogs);
  await page.clock.install();
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(shadow => {
    const runtime = (window as unknown as { SmokeRegressions: { setPlayerUiCss(css: string): void; installMainWorldRuntime(): void; bootstrapPlayerRuntime(): void } }).SmokeRegressions;
    runtime.setPlayerUiCss(shadow);
    runtime.installMainWorldRuntime();
    runtime.bootstrapPlayerRuntime();
  }, shadow);
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
  return page;
}
