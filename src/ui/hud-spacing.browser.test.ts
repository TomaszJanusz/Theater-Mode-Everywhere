import { testEngines } from '../test-utils/test-engines';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type * as HudApi from './hud';
import type { CONTROLS_VISIBILITY_ICON } from './controls-visibility';
import type { PlayerChromeContext } from './runtime-context';
import { bundleModules, playerStylesheets } from '../test-utils/player-boot';
import { ownTestBrowser } from '../test-utils/test-browser';

const CSS = playerStylesheets().ui;
const BUNDLE = bundleModules(["export * from './ui/hud'; export { CONTROLS_VISIBILITY_ICON } from './ui/controls-visibility';"], 'Hud');

const cases = ['less', 'original', 'more', 'moar', 'moaaarr', 'volume', 'quiet', 'muted', 'play', 'pause', 'voice', 'leveling', 'boost', 'layout', 'fit', 'switch', 'pin'] as const;

describe('confirmation HUD optical spacing', () => {
  for (const engine of testEngines()) {
    for (const scale of [1, 2]) for (const direction of ['ltr', 'rtl'] as const) {
      it(`balances painted icons at ${scale}x ${direction} in ${engine}`, { timeout: 60_000 }, async t => {
        const browser = await (await import('playwright'))[engine].launch({ headless: true });
        ownTestBrowser(t, browser);
        const page = await browser.newPage({ viewport: { width: 800, height: 300 }, deviceScaleFactor: scale });
        await page.setContent('<body style="margin:0;background:#171717"></body>');
        await page.evaluate('window.__name = value => value');
        await page.addScriptTag({ content: BUNDLE });
        await page.evaluate(css => {
          const host = document.createElement('div');
          host.id = 'fixture';
          host.dataset.motion = 'reduced';
          document.body.append(host);
          host.attachShadow({ mode: 'open' }).innerHTML = `<style>${css}</style>`;
        }, CSS);
        await page.clock.install();
        const results = [];
        for (const kind of cases) {
          const result = await page.evaluate(({ kind, direction }) => {
            const api = (window as unknown as { Hud: typeof HudApi & { CONTROLS_VISIBILITY_ICON: typeof CONTROLS_VISIBILITY_ICON } }).Hud;
            const root = document.getElementById('fixture')!.shadowRoot!;
            root.querySelectorAll('.theater-hud-plate').forEach(node => node.remove());
            // Only the UI mounting/painting boundary is stubbed; markup comes from createHud.
            const ctx = {
              session: { element: document.body },
              queryPlayerUi: (selector: string) => root.querySelector(selector),
              mountPlayerUi: (element: HTMLElement) => root.appendChild(element),
              paintOverlay: (element: HTMLElement) => element.style.setProperty('--accent-color', '#ff9900'),
              t: (key: string) => key === 'play' ? 'Play' : key === 'pause' ? 'Pause' : key
            } as unknown as PlayerChromeContext;
            const hud = api.createHud(ctx, () => {});
            const levels = { less: 'Less', original: 'Original', more: 'More', moar: 'MOAAR', moaaarr: 'MOAAARR!' };
            if (kind === 'less' || kind === 'original' || kind === 'more' || kind === 'moar' || kind === 'moaaarr') {
              const level = kind;
              hud.triggerStatusIndicator(`Bass: ${levels[level]}`, api.audioHudIcon('bass', { bass: level, voice: 'off', leveling: 'off' }), level);
            } else if (kind === 'volume' || kind === 'quiet' || kind === 'muted') {
              hud.triggerVolumeIndicator(kind === 'quiet' ? 0.25 : 0.75, kind === 'muted', 'up');
            } else if (kind === 'play' || kind === 'pause') {
              hud.triggerPlaybackIndicator(kind);
            } else {
              const icons = { voice: api.AUDIO_SETTING_ICONS.voice.hud, leveling: api.AUDIO_SETTING_ICONS.leveling.hud,
                boost: api.VOLUME_BOOST_ICONS.hud, layout: api.STATUS_HUD_LAYOUT_ICON,
                fit: api.STATUS_HUD_FIT_ICON, switch: api.STATUS_HUD_SWITCH_ICON, pin: api.CONTROLS_VISIBILITY_ICON };
              hud.triggerStatusIndicator(`${kind}: On`, icons[kind]);
            }
            const plate = root.querySelector<HTMLElement>('.theater-everywhere-volume-overlay')!;
            // Finish entrance motion, and freeze bass rocking/jitter through the real reduced-motion rule.
            for (const animation of root.getAnimations()) animation.finish();
            plate.dir = direction;
            const svg = plate.querySelector('svg')!;
            const bounds = [...svg.querySelectorAll<SVGGeometryElement>('path,rect,circle,line,polygon,polyline,ellipse')]
              .filter(shape => getComputedStyle(shape).display !== 'none')
              .map(shape => {
                const box = shape.getBBox();
                const style = getComputedStyle(shape);
                const stroke = style.stroke === 'none' ? 0 : parseFloat(style.strokeWidth) / 2;
                const matrix = shape.getScreenCTM()!;
                const a = new DOMPoint(box.x - stroke, box.y - stroke).matrixTransform(matrix);
                const b = new DOMPoint(box.x + box.width + stroke, box.y + box.height + stroke).matrixTransform(matrix);
                return { left: a.x, top: a.y, right: b.x, bottom: b.y };
              });
            const ink = { left: Math.min(...bounds.map(b => b.left)), right: Math.max(...bounds.map(b => b.right)),
              top: Math.min(...bounds.map(b => b.top)), bottom: Math.max(...bounds.map(b => b.bottom)) };
            const box = plate.getBoundingClientRect();
            // Compare to the text line box: glyph ascenders/descenders depend on the label.
            const text = plate.querySelector('.volume-hud-text')!.getBoundingClientRect();
            const style = getComputedStyle(plate);
            return { kind, leftPadding: parseFloat(style.paddingLeft), left: direction === 'ltr' ? ink.left - box.left : box.right - ink.right,
              gap: direction === 'ltr' ? text.left - ink.right : ink.left - text.right,
              right: direction === 'ltr' ? box.right - text.right : text.left - box.left,
              top: ink.top - box.top, bottom: box.bottom - ink.bottom,
              verticalOffset: (ink.top + ink.bottom - text.top - text.bottom) / 2,
              width: box.width, height: box.height, iconWidth: ink.right - ink.left, iconHeight: ink.bottom - ink.top };
          }, { kind, direction });
          results.push(result);
          if (process.env.HUD_SPACING_ARTIFACTS && engine === 'chromium' && scale === 1 && direction === 'ltr' && ['less', 'original', 'more', 'moar', 'moaaarr', 'volume'].includes(kind)) {
            mkdirSync(process.env.HUD_SPACING_ARTIFACTS, { recursive: true });
            await page.screenshot({ path: path.join(process.env.HUD_SPACING_ARTIFACTS, `${kind}.png`) });
          }
        }
        if (process.env.HUD_SPACING_ARTIFACTS) {
          mkdirSync(process.env.HUD_SPACING_ARTIFACTS, { recursive: true });
          writeFileSync(path.join(process.env.HUD_SPACING_ARTIFACTS, `${engine}-${scale}x-${direction}.json`), JSON.stringify(results, null, 2));
        }
        for (const result of results) {
          assert.ok(Math.abs(result.left - result.right) <= 1, `${result.kind}: balanced ink insets ${JSON.stringify(result)}`);
          assert.ok(Math.abs(result.verticalOffset) <= 0.5, `${result.kind}: vertically centered ink ${JSON.stringify(result)}`);
          assert.ok(Math.abs(result.gap - 10) <= 1, `${result.kind}: shared 10px ink-to-text gap ${JSON.stringify(result)}`);
        }
      });
    }
  }
});
