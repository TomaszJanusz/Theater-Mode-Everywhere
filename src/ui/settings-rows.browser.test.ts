import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Browser } from 'playwright';
import { readStylesheet } from '../test-utils/styles';

const require = createRequire(import.meta.url);
const SRC = new URL('../', import.meta.url).pathname;
const UI_CSS = readStylesheet(path.join(SRC, 'ui/shadow.css'));
const esbuild = require('esbuild') as { buildSync(options: object): { outputFiles: Array<{ text: string }> } };
const BUNDLE = esbuild.buildSync({
  stdin: {
    contents: [
      "export { createPlayerSettings } from './ui/player-settings';",
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

// Rows as controls.ts adds them, with the longest realistic chrome: NEW badges, a
// two-chip shortcut and the longest value the row can show.
const ROWS = [
  { label: 'videoFitLabel', values: ['videoFitContain', 'videoFitCover', 'videoFitFill'], shortcut: 'Shift+Z' },
  { label: 'pictureAlignLabel', values: ['pictureAlignTop', 'pictureAlignCenter'], shortcut: 'Shift+L', isNew: 'playerPictureLayout' },
  { label: 'keepControlsVisibleTitle', values: ['badgeNew'], shortcut: 'Shift+H', isNew: 'playerAlwaysShowControls' },
  { label: 'cycleSwitchVideo', values: [], shortcut: 'Shift+V' },
  { label: 'autoEnterTheaterTitle', values: [], shortcut: 'Shift+A' },
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
              for (const key of audio) add(messages[key] ?? key, 'audio', 'Shift+A', messages.badgeNew);
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
              if (row.truncated) assert.ok(result.width >= Math.min(520, result.viewport - 48) - 1, `${context}: "${row.text}" truncated in a menu below its cap`);
            }
            assert.ok(result.left >= 0 && result.right <= result.viewport, `${context}: menu leaves the viewport`);
          }
          assert.deepEqual(errors, []);
          await page.close();
        }
      });
    });
  }

  for (const engine of ['chromium', 'firefox'] as const) {
    it(`keeps the menu width when every toggle changes value in ${engine}`, { timeout: 120_000 }, async () => {
      await withBrowser(engine, async browser => {
        for (const viewport of [{ width: 360, height: 640 }, { width: 1280, height: 800 }]) {
          const page = await browser.newPage({ viewport });
          await page.setContent('<body style="margin:0"></body>');
          await page.addStyleTag({ content: UI_CSS });
          await page.evaluate('window.__name = value => value');
          await page.addScriptTag({ content: BUNDLE });
          for (const locale of LOCALES) {
            const messages = { ...english, ...catalog(locale) };
            // Each toggleable row with every state it can show, as controls.ts wires them.
            const toggles = [
              ...ROWS.filter(row => row.values.length > 1 || row.label === 'keepControlsVisibleTitle'),
              { label: 'autoEnterTheaterTitle', values: ['autoEnterTheaterOn', 'autoEnterTheaterOff'] },
              { label: 'volumeBoostLabel', values: ['volumeBoostOn', 'volumeBoostOff'] },
              { label: 'voiceBoostLabel', values: ['voiceBoostOff', 'voiceBoostLight', 'voiceBoostStrong'] },
              { label: 'volumeLevelingLabel', values: ['volumeLevelingOff', 'volumeLevelingLight', 'volumeLevelingStrong'] },
              { label: 'bassLabel', values: ['bassLess', 'bassOriginal', 'bassMore'] }
            ].map(row => row.label === 'keepControlsVisibleTitle'
              ? { ...row, values: ['controlsVisibilityOn', 'controlsVisibilityOff'] }
              : row).map(row => ({ text: messages[row.label], values: row.values.map(key => messages[key]) }));
            const widths = await page.evaluate(({ toggles, messages, dir }) => {
              document.body.replaceChildren();
              document.body.dir = dir;
              const mount = document.createElement('div');
              mount.style.cssText = 'position:fixed;inset-inline-end:12px;bottom:80px;width:32px';
              document.body.append(mount);
              const api = (window as any).SettingsRows;
              const settings = api.createPlayerSettings({
                t: (key: string) => messages[key] ?? key,
                ui: () => ({ featureHighlights: { installed: '2.0', seenThrough: '1.0', enabled: true, now: 0 } }),
                uiStore: { subscribe: () => () => {} },
                actions: { setIcon(element: HTMLElement, svg: string) { element.innerHTML = svg; }, showToolbar() {}, updateCaptionDock() {} },
                paintOverlay() {}
              }, new api.DisposableScope());
              mount.append(settings.container);
              const rows = toggles.map((toggle: { text: string; values: string[] }) => {
                const button = document.createElement('button');
                button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18"></svg>';
                return { row: settings.addRow(button, toggle.text, 'player'), values: toggle.values };
              });
              settings.button.click();
              const menu = settings.panel as HTMLElement;
              const widths: number[] = [];
              for (const { row, values } of rows) {
                for (const value of values) {
                  row.update('Shift+A', value, values);
                  widths.push(Math.round(menu.getBoundingClientRect().width * 100) / 100);
                }
              }
              return widths;
            }, { toggles, messages, dir: locale === 'ar' ? 'rtl' : 'ltr' });
            assert.ok(widths.length > 10);
            assert.deepEqual([...new Set(widths)].length, 1, `${engine} ${locale} ${viewport.width}px: menu width changed ${[...new Set(widths)]}`);
          }
          await page.close();
        }
      });
    });
  }
});
