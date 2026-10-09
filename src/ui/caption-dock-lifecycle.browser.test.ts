import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild') as { buildSync(options: object): { outputFiles: Array<{ text: string }> } };
const bundle = esbuild.buildSync({
  stdin: {
    contents: "export { createToolbar } from './ui/toolbar'; export { PlayerSession } from './core/player-session';",
    resolveDir: new URL('../', import.meta.url).pathname, loader: 'ts'
  },
  bundle: true, write: false, format: 'iife', globalName: 'DockTest',
  platform: 'browser', target: 'es2022', logLevel: 'silent'
}).outputFiles[0].text;

describe('caption dock frame and cached geometry lifecycle', () => {
  it('coalesces bursts, measures media once, refreshes changed overlays, and cancels on teardown', async t => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) { t.skip('Chromium not installed'); return; }
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
      await page.setContent(`<video style="width:900px;height:600px"></video>
        <div class="theater-controls-wrapper" style="width:800px;height:60px"></div>
        <div class="theater-caption-overlay visible" style="width:500px;height:40px">
          <span class="theater-caption-overlay-text" style="line-height:20px">Caption</span>
        </div>`);
      await page.addScriptTag({ content: 'window.__name = (fn) => fn;' });
      await page.addScriptTag({ content: bundle });
      const report = await page.evaluate(async () => {
        const api = (window as unknown as { DockTest: {
          PlayerSession: new () => { rebind(element: HTMLElement): void; activate(): void };
          createToolbar(ctx: unknown): { updateCaptionDock(immediate?: boolean): void; resetCaptionDock(): void };
        } }).DockTest;
        const video = document.querySelector('video')!;
        const controls = document.querySelector('.theater-controls-wrapper') as HTMLElement & {
          _mediaFeatures: { setCaptionLineLimit(lines: number): void; readHostCaptionLayout(): {
            width: number; height: number; lineHeight: number; rows: number; motionTarget?: HTMLElement
          } | null };
        };
        let layouts = 0;
        let lineLimit = 0;
        let mediaReads = 0;
        let scans = 0;
        const session = new api.PlayerSession();
        session.rebind(video);
        session.activate();
        const originalRect = video.getBoundingClientRect.bind(video);
        video.getBoundingClientRect = () => { mediaReads++; return originalRect(); };
        controls._mediaFeatures = {
          setCaptionLineLimit: (lines: number) => { layouts++; lineLimit = lines; }, readHostCaptionLayout: () => null
        };
        // Drive frame boundaries explicitly; DOM mutation observers remain real.
        const frames = new Map<number, FrameRequestCallback>();
        let nextFrame = 0;
        window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
        window.cancelAnimationFrame = id => { frames.delete(id); };
        Object.defineProperty(window, 'ResizeObserver', { value: undefined });
        const flush = async () => {
          await Promise.resolve();
          const pending = [...frames.values()];
          frames.clear();
          for (const callback of pending) callback(0);
          await Promise.resolve();
        };
        const toolbar = api.createToolbar({
          session,
          queryPlayerUi: (selector: string) => document.querySelector(selector),
          queryPlayerUiAll: (selector: string) => { scans++; return [...document.querySelectorAll(selector)]; }
        });
        for (let i = 0; i < 25; i++) toolbar.updateCaptionDock();
        const queued = frames.size;
        await flush();
        const initial = { layouts, mediaReads, scans };
        // Drain the initial style mutation before checking stable frames.
        await flush();
        const beforeBurst = { layouts, mediaReads, scans };
        for (let i = 0; i < 25; i++) toolbar.updateCaptionDock();
        await flush();
        const stable = { layouts: layouts - beforeBurst.layouts, mediaReads: mediaReads - beforeBurst.mediaReads,
          scans: scans - beforeBurst.scans, queued: frames.size };
        const baseBottom = document.documentElement.style.getPropertyValue('--theater-caption-bottom');
        const obstacle = document.createElement('div');
        obstacle.className = 'theater-button-tooltip visible';
        obstacle.style.cssText = 'position:fixed;left:200px;top:440px;width:500px;height:80px;opacity:1';
        document.body.appendChild(obstacle);
        await flush();
        const obstacleBottom = document.documentElement.style.getPropertyValue('--theater-caption-bottom');
        const afterInsertion = scans;
        obstacle.classList.remove('visible');
        await flush();
        const hiddenBottom = document.documentElement.style.getPropertyValue('--theater-caption-bottom');
        const visibilityScans = scans - afterInsertion;
        Object.defineProperties(video, { videoWidth: { value: 1920 }, videoHeight: { value: 720 } });
        document.documentElement.classList.add('theater-everywhere-picture-top');
        await flush();
        await flush();
        const raisedBottom = document.documentElement.style.getPropertyValue('--theater-caption-bottom');
        const overlay = document.querySelector('.theater-caption-overlay') as HTMLElement;
        const beforeRows = scans;
        overlay.style.height = '80px';
        overlay.querySelector('span')!.textContent = 'Caption with more lines';
        await flush();
        await flush();
        const multilineBottom = document.documentElement.style.getPropertyValue('--theater-caption-bottom');
        const restTransition = overlay.style.getPropertyValue('transition');
        const rowChangeScans = scans - beforeRows;
        document.documentElement.classList.add('theater-everywhere-picture-moving');
        await flush();
        const movingTransition = overlay.style.getPropertyValue('transition');
        document.documentElement.classList.remove('theater-everywhere-picture-moving');
        overlay.classList.remove('visible');
        const nativeHost = document.createElement('div');
        nativeHost.style.cssText = 'width:500px;height:40px';
        document.body.append(nativeHost);
        controls._mediaFeatures.readHostCaptionLayout = () => ({
          width: 500, height: nativeHost.offsetHeight, lineHeight: 20,
          rows: Math.round(nativeHost.offsetHeight / 20), motionTarget: nativeHost
        });
        toolbar.updateCaptionDock(true);
        await flush();
        const beforeNativeFrame = document.documentElement.style.getPropertyValue('--theater-caption-bottom');
        let nativeBeforePaint = '';
        const nativeObserver = new MutationObserver(() => {
          toolbar.updateCaptionDock(true);
          nativeBeforePaint = document.documentElement.style.getPropertyValue('--theater-caption-bottom');
        });
        nativeObserver.observe(nativeHost, { childList: true });
        window.requestAnimationFrame(() => {
          nativeHost.style.height = '120px';
          nativeHost.textContent = 'Native cue changed in its own animation frame';
        });
        await flush();
        const afterNativeFrame = document.documentElement.style.getPropertyValue('--theater-caption-bottom');
        nativeObserver.disconnect();
        const beforeExit = layouts;
        toolbar.updateCaptionDock();
        toolbar.resetCaptionDock();
        await flush();
        obstacle.remove();
        await flush();
        return { queued, initial, stable, baseBottom, obstacleBottom, hiddenBottom, visibilityScans,
          raisedBottom, multilineBottom, lineLimit, restTransition, movingTransition, rowChangeScans,
          beforeNativeFrame, nativeBeforePaint, afterNativeFrame,
          afterExit: layouts - beforeExit, queuedAfterExit: frames.size };
      });
      assert.equal(report.queued, 1);
      assert.deepEqual(report.initial, { layouts: 1, mediaReads: 1, scans: 1 });
      assert.deepEqual(report.stable, { layouts: 1, mediaReads: 1, scans: 0, queued: 0 });
      assert.ok(Number.parseFloat(report.obstacleBottom) > Number.parseFloat(report.baseBottom), JSON.stringify(report));
      assert.equal(report.hiddenBottom, report.baseBottom);
      assert.equal(report.visibilityScans, 0);
      assert.notEqual(report.multilineBottom, report.raisedBottom);
      assert.equal(report.lineLimit, 3);
      assert.equal(report.rowChangeScans, 0);
      assert.ok(!report.restTransition.includes('bottom'), report.restTransition);
      assert.ok(report.movingTransition.includes('bottom'), report.movingTransition);
      assert.notEqual(report.nativeBeforePaint, report.beforeNativeFrame);
      assert.equal(report.nativeBeforePaint, report.afterNativeFrame);
      assert.equal(report.afterExit, 0);
      assert.equal(report.queuedAfterExit, 0);
    } finally {
      await browser.close();
    }
  });
});
