import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Browser } from 'playwright';
import { readStylesheet } from '../test-utils/styles';
import { NEW_BADGE_CSS } from './new-badge';

const require = createRequire(import.meta.url);
const SRC = new URL('../', import.meta.url).pathname;
const UI_CSS = readStylesheet(path.join(SRC, 'ui/shadow.css')) + NEW_BADGE_CSS;
const esbuild = require('esbuild') as { buildSync(options: object): { outputFiles: Array<{ text: string }> } };
const BUNDLE = esbuild.buildSync({
  stdin: {
    contents: [
      "export { createPlayerSettings } from './ui/player-settings';",
      "export { createControls } from './ui/controls';",
      "export { PlayerUiStore } from './ui/store';",
      "export { createChromeRefs, createPlayerChromeContext } from './ui/runtime-context';",
      "export { DisposableScope } from './core/disposable-scope';",
      "export { AUDIO_LABEL_KEYS, AUDIO_SETTING_NAMES } from './audio-settings';"
    ].join('\n'),
    resolveDir: SRC,
    loader: 'ts'
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'SettingsRows',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'silent'
}).outputFiles[0].text;

const LOCALES_DIR = path.join(SRC, '../_locales');
const LOCALES = readdirSync(LOCALES_DIR).sort();
const catalog = (locale: string): Record<string, string> => Object.fromEntries(
  Object.entries(JSON.parse(readFileSync(path.join(LOCALES_DIR, locale, 'messages.json'), 'utf8')) as Record<string, { message: string }>)
    .map(([key, entry]) => [key, entry.message]));
const english = catalog('en');

// Rows as controls.ts adds them, with the longest realistic chrome: icon dots, a
// two-chip shortcut and the longest value the row can show.
const ROWS = [
  { label: 'videoFitLabel', values: ['videoFitContain', 'videoFitCover', 'videoFitFill'], shortcut: 'Shift+Z' },
  { label: 'pictureAlignLabel', values: ['pictureAlignTop', 'pictureAlignCenter'], shortcut: 'Shift+L', isNew: 'playerPictureLayout' },
  { label: 'keepControlsVisibleTitle', values: ['controlsVisibilityOn', 'controlsVisibilityOff'], shortcut: 'Shift+H', isNew: 'playerAlwaysShowControls' },
  { label: 'cycleSwitchVideo', values: [], shortcut: 'Shift+V' },
  { label: 'autoEnterTheaterTitle', values: ['autoEnterTheaterOn', 'autoEnterTheaterOff', 'statusUnavailable'], shortcut: 'Shift+A' },
  { label: 'keyboardShortcutsTitle', values: [], shortcut: 'H', section: 'shortcuts' },
  { label: 'extensionSettingsLabel', values: [], shortcut: '', section: 'footer' }
];

async function withBrowser(engine: 'chromium' | 'firefox', run: (browser: Browser) => Promise<void>): Promise<void> {
  const browserType = (await import('playwright'))[engine];
  assert.ok(existsSync(browserType.executablePath()), `${engine} must be installed`);
  const browser = await browserType.launch({ headless: true });
  try { await run(browser); } finally { await browser.close(); }
}

describe('settings menu rows stay on one line', () => {
  for (const engine of ['chromium', 'firefox'] as const) {
    it(`fits every locale on one line in ${engine}`, { timeout: 120_000 }, async () => {
      await withBrowser(engine, async browser => {
        // 360px is the narrowest viewport the menu is designed for.
        for (const viewport of [{ width: 360, height: 640 }, { width: 1280, height: 800 }]) {
          const page = await browser.newPage({ viewport });
          const errors: string[] = [];
          page.on('pageerror', error => errors.push(error.message));
          await page.setContent('<body style="margin:0"></body>');
          await page.addStyleTag({ content: UI_CSS });
          await page.evaluate('window.__name = value => value');
          await page.addScriptTag({ content: BUNDLE });
          for (const locale of LOCALES) {
            const messages = { ...english, ...catalog(locale) };
            const rows = ROWS.map(row => ({ ...row,
              text: messages[row.label],
              value: row.values.map(key => messages[key]).sort((a, b) => b.length - a.length)[0] ?? '' }));
            const audio = await page.evaluate(`SettingsRows.AUDIO_SETTING_NAMES.map(name => SettingsRows.AUDIO_LABEL_KEYS[name])`) as string[];
            const result = await page.evaluate(({ rows, audio, messages, dir }) => {
              document.body.replaceChildren();
              document.body.dir = dir;
              const mount = document.createElement('div');
              mount.style.cssText = 'position:fixed;inset-inline-end:12px;bottom:80px;width:32px';
              document.body.append(mount);
              const api = (window as any).SettingsRows;
              const scope = new api.DisposableScope();
              const settings = api.createPlayerSettings({
                t: (key: string) => messages[key] ?? key,
                ui: () => ({ featureHighlights: { installed: '2.0', seenThrough: '1.0', enabled: true, now: 0 } }),
                uiStore: { subscribe: () => () => {} },
                actions: { setIcon(element: HTMLElement, svg: string) { element.innerHTML = svg; }, showToolbar() {}, updateCaptionDock() {} },
                paintOverlay() {}
              }, scope);
              mount.append(settings.container);
              const add = (label: string, section: string, shortcut: string, value: string, isNew?: string) => {
                const button = document.createElement('button');
                button.className = 'theater-control-btn';
                button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"></svg>';
                settings.addRow(button, label, section, isNew).update(shortcut, value);
              };
              // The Bass row shows one of four levels; reserve room for the longest.
            const bassValue = ['bassLess', 'bassOriginal', 'bassMore', 'bassMoar'].map(key => messages[key]).sort((a, b) => b.length - a.length)[0];
            for (const key of audio) add(messages[key] ?? key, 'audio', 'Shift+A', key === 'bassLabel' ? bassValue : messages.badgeNew);
              for (const row of rows) add(row.text, row.section ?? 'player', row.shortcut, row.value, row.isNew);
              settings.button.click();
              const menu = settings.panel as HTMLElement;
              const bounds = menu.getBoundingClientRect();
              const rowStats = [...menu.querySelectorAll<HTMLElement>('button.theater-settings-row')].map(row => {
                const label = row.querySelector<HTMLElement>('.theater-settings-label')!;
                const box = row.getBoundingClientRect();
                return {
                  text: label.textContent,
                  height: Math.round(box.height),
                  overflow: row.scrollWidth - row.clientWidth,
                  truncated: label.scrollWidth > label.clientWidth,
                  titled: label.title === label.textContent
                };
              });
              return { rowStats, left: bounds.left, right: bounds.right, width: bounds.width, viewport: innerWidth };
            }, { rows, audio, messages, dir: locale === 'ar' ? 'rtl' : 'ltr' });
            const context = `${engine} ${locale} ${viewport.width}px`;
            assert.ok(result.rowStats.length >= ROWS.length, context);
            for (const row of result.rowStats) {
              assert.ok(row.height <= 41, `${context}: "${row.text}" wraps (${row.height}px)`);
              assert.ok(row.overflow <= 0, `${context}: "${row.text}" overflows its row by ${row.overflow}px`);
              assert.ok(row.titled, `${context}: "${row.text}" lacks its full-text title`);
              // Truncation is the last resort: only when the menu has reached its cap.
              if (row.truncated) assert.ok(result.width >= Math.min(340, result.viewport - 48) - 1, `${context}: "${row.text}" truncated in a menu below its cap`);
            }
            assert.ok(result.width <= Math.min(340, result.viewport - 48) + 1, `${context}: menu exceeds its compact width`);
            assert.ok(result.left >= 0 && result.right <= result.viewport, `${context}: menu leaves the viewport`);
          }
          assert.deepEqual(errors, []);
          await page.close();
        }
      });
    });
  }

  for (const engine of ['chromium', 'firefox'] as const) {
    it(`keeps the menu width when every toggle changes value in ${engine}`, { timeout: 180_000 }, async () => {
      await withBrowser(engine, async browser => {
        for (const viewport of [{ width: 360, height: 640 }, { width: 1280, height: 800 }]) {
          const page = await browser.newPage({ viewport });
          const errors: string[] = [];
          page.on('pageerror', error => errors.push(error.message));
          await page.setContent('<body style="margin:0"></body>');
          await page.addStyleTag({ content: UI_CSS });
          await page.evaluate('window.__name = value => value');
          await page.addScriptTag({ content: BUNDLE });
          for (const locale of LOCALES) {
            const messages = { ...english, ...catalog(locale) };
            // Real createControls wiring: the store actions below drive each toggle row's own update.
            const { widths, detailWidths } = await page.evaluate(({ messages, dir }) => {
              document.body.replaceChildren();
              document.body.dir = dir;
              const mount = document.createElement('div');
              mount.style.cssText = 'position:fixed;inset-inline-end:12px;bottom:80px;width:32px';
              document.body.append(mount);
              const api = (window as any).SettingsRows;
              const video = document.createElement('video');
              document.body.append(video);
              const store = new api.PlayerUiStore();
              const refs = api.createChromeRefs();
              const noop = () => {};
              const actions = new Proxy({
                setIcon(element: HTMLElement, svg: string) { element.innerHTML = svg; },
                escapeHtml: (value: string) => value,
                findAllVideosDeep: () => []
              } as Record<string, unknown>, { get: (target, key: string) => target[key] ?? noop });
              const ctx = {
                session: { element: video, currentEpoch: 1, isExiting: false, isIdle: false, publishSnapshot: noop },
                uiStore: store, frames: {}, refs, ui: () => store.getState(),
                t: (key: string, ...subs: string[]) => (messages[key] ?? key).replace('$1', subs[0] ?? ''),
                queryPlayerUi: (selector: string) => document.querySelector(selector),
                queryPlayerUiAll: (selector: string) => [...document.querySelectorAll(selector)],
                mountPlayerUi: (element: HTMLElement) => mount.appendChild(element),
                destroyPlayerUi: noop,
                eventPathIncludes: (event: Event, node: Node | null) => !!node && event.composedPath().includes(node),
                eventPathMatches: () => false,
                paintOverlay: noop,
                mediaHasSource: () => true,
                requestVideoPlay: noop,
                actions
              };
              const controls = api.createControls(ctx, noop);
              controls.createCustomControls(video);
              const menu = document.querySelector<HTMLElement>('#theater-player-settings')!;
              (menu.parentElement!.querySelector('button') as HTMLElement).click();
              const states = (action: string, values: unknown[]) => values.map(value => ({ type: action, value }));
              const sequence = [
                ...states('SET_VIDEO_FIT', ['contain', 'cover', 'fill', 'contain']),
                ...states('SET_PICTURE_ALIGN', ['top', 'center']),
                ...states('SET_KEEP_CONTROLS_VISIBLE', [true, false]),
                ...states('SET_AUTO_ENTER_THEATER', [true, false]),
                ...states('SET_VOLUME_BOOST', [true, false]),
                ...['light', 'strong', 'off'].map(level => ({ type: 'SET_AUDIO', value: { voice: level, leveling: level, bass: level === 'light' ? 'less' : level === 'strong' ? 'more' : 'original' } }))
              ];
              const valueWidths = () => [...menu.querySelectorAll<HTMLElement>('.theater-settings-detail')]
                .map(detail => Math.round(detail.getBoundingClientRect().width * 100) / 100);
              const widths = [Math.round(menu.getBoundingClientRect().width * 100) / 100];
              const detailWidths = [valueWidths()];
              for (const action of sequence) {
                store.dispatch(action);
                widths.push(Math.round(menu.getBoundingClientRect().width * 100) / 100);
                detailWidths.push(valueWidths());
              }
              return { widths, detailWidths };
            }, { messages, dir: locale === 'ar' ? 'rtl' : 'ltr' });
            assert.ok(widths.length > 10);
            for (const values of detailWidths) assert.deepEqual(values, detailWidths[0],
              `${engine} ${locale}: reserved value widths changed`);
            assert.deepEqual([...new Set(widths)].length, 1, `${engine} ${locale} ${viewport.width}px: menu width changed ${[...new Set(widths)]}`);
          }
          assert.deepEqual(errors, []);
          await page.close();
        }
      });
    });
  }
});
