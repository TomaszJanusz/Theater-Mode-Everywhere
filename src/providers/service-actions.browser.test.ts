import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAY = 'https://www.disneyplus.com/pl-pl/play/0c64c5db-0d1d-48c7-a6d6-8d2d56b16ca8';
const WATCH = 'https://www.crunchyroll.com/pl/watch/GPWUKZGZX/maomao';

type Esbuild = {
  buildSync: (options: {
    entryPoints: string[];
    bundle: boolean;
    write: boolean;
    format: 'iife';
    globalName: string;
    platform: 'browser';
    target: string;
    logLevel: 'silent';
  }) => { outputFiles: Array<{ text: string }> };
};

function bundle(globalName: string, entry: string): string {
  const esbuild = require('esbuild') as Esbuild;
  return esbuild.buildSync({
    entryPoints: [path.join(SRC, entry)],
    bundle: true,
    write: false,
    format: 'iife',
    globalName,
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent'
  }).outputFiles[0].text;
}

const disneyBundle = bundle('TeDisneyActions', 'providers/disney/service-actions.ts');
const crunchyBundle = bundle('TeCrunchyActions', 'providers/crunchyroll/service-actions.ts');

describe('disney and crunchyroll service actions', () => {
  it('reads Disney skip, up-next, and end-card controls from open shadow roots', async () => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) return;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({ content: disneyBundle });
      const report = await page.evaluate(`(() => {
        const play = ${JSON.stringify(PLAY)};
        const create = () => window.TeDisneyActions.createDisneyServiceActions({
          host: () => true,
          href: () => play
        });
        const mountSkip = (label) => {
          const player = document.createElement('disney-web-player');
          const overlay = document.createElement('skip-overlay');
          const skip = document.createElement('skip-button');
          const face = document.createElement('button');
          face.type = 'button';
          const text = document.createElement('span');
          text.className = 'label';
          text.textContent = label;
          face.append(text);
          face.addEventListener('click', () => { window.__skipClicks = (window.__skipClicks || 0) + 1; });
          skip.attachShadow({ mode: 'open' }).append(face);
          overlay.attachShadow({ mode: 'open' }).append(skip);
          player.append(overlay);
          document.body.append(player);
          return face;
        };
        const mountUpNext = (label, hidden) => {
          const host = document.createElement('up-next-lite-v1');
          host.hidden = hidden;
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'up-next-lite-v1-overlay__button';
          const text = document.createElement('span');
          text.className = 'up-next-lite-v1-overlay__button-label';
          text.textContent = label;
          button.append(text);
          button.addEventListener('click', () => { window.__nextClicks = (window.__nextClicks || 0) + 1; });
          host.attachShadow({ mode: 'open' }).append(button);
          document.body.append(host);
          return button;
        };
        document.body.replaceChildren();
        const absent = create().read();
        mountSkip('Pomiń czołówkę');
        const skip = create().read();
        const skipId = skip[0] && skip[0].id;
        const activated = create().activate(skipId);
        const stale = create().activate('disney:skip|nope');
        document.body.replaceChildren();
        mountSkip('Pomiń czołówkę');
        const hiddenSkip = document.querySelector('disney-web-player')?.querySelector('skip-overlay')?.shadowRoot?.querySelector('skip-button')?.shadowRoot?.querySelector('button');
        hiddenSkip.hidden = true;
        const hidden = create().read();
        document.body.replaceChildren(document.createElement('disney-web-player'));
        mountUpNext('Następny odcinek za 4', false);
        const next = create().read();
        document.querySelector('up-next-lite-v1').hidden = true;
        const nextHidden = create().read();
        document.body.replaceChildren();
        const player = document.createElement('disney-web-player');
        document.body.append(player);
        const end = document.createElement('end-card-overlay');
        const shadow = end.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<span class="end-card-header__countdown-text">Następny odcinek za 3</span>'
          + '<button type="button" class="end-card-overlay__content-tile"></button>'
          + '<button type="button" class="end-card-header__close-container">Zamknij</button>';
        let tileClicks = 0;
        let closeClicks = 0;
        shadow.querySelector('.end-card-overlay__content-tile').addEventListener('click', () => { tileClicks += 1; });
        shadow.querySelector('.end-card-header__close-container').addEventListener('click', () => { closeClicks += 1; });
        document.body.append(end);
        const endActions = create().read();
        create().activate(endActions.find(action => action.id.startsWith('disney:end')).id);
        create().activate(endActions.find(action => action.id.startsWith('disney:close')).id);
        const fadedNext = document.createElement('up-next-lite-v1');
        const fadedButton = document.createElement('button');
        fadedButton.type = 'button';
        fadedButton.className = 'up-next-lite-v1-overlay__button';
        fadedButton.textContent = 'Następny odcinek za 1';
        fadedButton.style.display = 'none';
        fadedNext.attachShadow({ mode: 'open' }).append(fadedButton);
        document.body.append(fadedNext);
        const endDespiteFadedNext = create().read();
        document.documentElement.setAttribute('data-te-disney-integration-off', '');
        const flagged = create().read();
        document.documentElement.removeAttribute('data-te-disney-integration-off');
        const browse = window.TeDisneyActions.createDisneyServiceActions({
          host: () => true,
          href: () => 'https://www.disneyplus.com/pl-pl/browse/home'
        }).read();
        const foreign = window.TeDisneyActions.createDisneyServiceActions({
          host: () => false,
          href: () => play
        }).read();
        return {
          absent, skip, activated, stale, hidden, next, nextHidden, endActions, endDespiteFadedNext, tileClicks, closeClicks, flagged, browse, foreign,
          skipClicks: window.__skipClicks || 0
        };
      })()`) as {
        absent: Array<{ id: string; label: string }>;
        skip: Array<{ id: string; label: string }>;
        activated: boolean;
        stale: boolean;
        hidden: Array<{ label: string }>;
        next: Array<{ id: string; label: string }>;
        nextHidden: Array<{ label: string }>;
        endActions: Array<{ id: string; label: string; progress?: number }>;
        endDespiteFadedNext: Array<{ label: string }>;
        tileClicks: number;
        closeClicks: number;
        flagged: unknown[];
        browse: unknown[];
        foreign: unknown[];
        skipClicks: number;
      };
      assert.deepEqual(report.absent, []);
      assert.equal(report.skip.length, 1);
      assert.equal(report.skip[0].label, 'Pomiń czołówkę');
      assert.match(report.skip[0].id, /^disney:skip\|0c64c5db-0d1d-48c7-a6d6-8d2d56b16ca8\|Pomiń czołówkę\|e\d+$/);
      assert.equal(report.activated, true);
      assert.equal(report.skipClicks, 1);
      assert.equal(report.stale, false);
      assert.deepEqual(report.hidden, []);
      assert.equal(report.next[0].label, 'Następny odcinek za 4');
      assert.match(report.next[0].id, /^disney:next\|0c64c5db-0d1d-48c7-a6d6-8d2d56b16ca8\|e\d+$/);
      assert.deepEqual(report.nextHidden, []);
      assert.deepEqual(report.endActions.map(action => action.label), ['Następny odcinek za 3', 'Zamknij']);
      assert.deepEqual(report.endDespiteFadedNext.map(action => action.label), ['Następny odcinek za 3', 'Zamknij']);
      assert.equal(report.tileClicks, 1);
      assert.equal(report.closeClicks, 1);
      assert.deepEqual(report.flagged, []);
      assert.deepEqual(report.browse, []);
      assert.deepEqual(report.foreign, []);
    } finally {
      await browser.close();
    }
  });

  it('keeps a Crunchyroll skip through control fade and announces next only at the ending', async () => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) return;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent('<div id="root"></div>');
      await page.addScriptTag({ content: crunchyBundle });
      const report = await page.evaluate(`(() => {
        const watch = ${JSON.stringify(WATCH)};
        const media = 'GPWUKZGZX';
        let time = 0;
        let duration = 1370;
        let ended = false;
        let paused = false;
        const video = document.createElement('video');
        Object.defineProperty(video, 'currentTime', { configurable: true, get: () => time, set: (value) => { time = Number(value); } });
        Object.defineProperty(video, 'duration', { configurable: true, get: () => duration });
        Object.defineProperty(video, 'ended', { configurable: true, get: () => ended });
        Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
        video.pause = () => { paused = true; };
        const root = document.createElement('div');
        root.id = 'player-container';
        const controls = document.createElement('div');
        controls.setAttribute('data-testid', 'player-controls-root');
        const skip = document.createElement('button');
        skip.type = 'button';
        skip.className = 'kat:self-end kat:opacity-0';
        skip.setAttribute('aria-hidden', 'true');
        skip.tabIndex = -1;
        skip.style.opacity = '0';
        skip.style.pointerEvents = 'none';
        skip.textContent = 'Pomiń czołówkę';
        let skipClicks = 0;
        skip.addEventListener('click', () => { skipClicks += 1; });
        const next = document.createElement('button');
        next.type = 'button';
        next.setAttribute('data-testid', 'next-episode-button');
        next.setAttribute('aria-label', 'Następny odcinek');
        let nextClicks = 0;
        next.addEventListener('click', () => { nextClicks += 1; });
        const icon = document.createElement('button');
        icon.type = 'button';
        icon.setAttribute('aria-label', 'Odtwórz');
        controls.append(skip, icon, next);
        root.append(video, controls);
        const snapshot = document.createElement('div');
        snapshot.id = 'theater-everywhere-crunchyroll-skip-windows';
        snapshot.hidden = true;
        const windows = [
          { type: 'intro', start: 0, end: 90 },
          { type: 'credits', start: 1265, end: 1355 },
          { type: 'preview', start: 1355, end: 1370 }
        ];
        snapshot.textContent = JSON.stringify({ mediaId: media, windows });
        document.body.replaceChildren(root, snapshot);
        const create = () => window.TeCrunchyActions.createCrunchyrollServiceActions({
          host: () => true,
          href: () => watch
        });
        time = 12;
        const intro = create().read();
        const introId = intro.find(action => action.id.includes('skip')).id;
        const sought = create().activate(introId);
        const afterSeek = time;
        const seekClicks = skipClicks;
        time = 200;
        const middle = create().read();
        skip.removeAttribute('aria-hidden');
        skip.tabIndex = 0;
        skip.style.opacity = '1';
        skip.style.pointerEvents = 'auto';
        skip.textContent = 'Pomiń czołówkę';
        const stale = create().read();
        time = 12;
        const visible = create().read();
        const visibleId = visible.find(action => action.id.includes('skip')).id;
        create().activate(visibleId);
        time = 1300;
        skip.textContent = 'Pomiń napisy';
        skip.setAttribute('aria-hidden', 'true');
        skip.tabIndex = -1;
        skip.style.opacity = '0';
        const credits = create().read();
        time = 1360;
        skip.textContent = 'Pomiń zajawkę';
        const preview = create().read();
        time = 1368;
        const ending = create().read();
        ended = true;
        time = 1370;
        next.setAttribute('aria-hidden', 'true');
        next.tabIndex = -1;
        next.style.opacity = '0';
        next.style.pointerEvents = 'none';
        const finished = create().read();
        const nextId = finished.find(action => action.id.includes(':next|')).id;
        const nextActivated = create().activate(nextId);
        snapshot.textContent = JSON.stringify({ mediaId: 'OTHERMEDIA', windows });
        time = 12;
        ended = false;
        skip.textContent = 'Pomiń czołówkę';
        const foreignWindows = create().read();
        document.documentElement.setAttribute('data-te-crunchyroll-integration-off', '');
        const flagged = create().read();
        document.documentElement.removeAttribute('data-te-crunchyroll-integration-off');
        const otherEpisode = window.TeCrunchyActions.createCrunchyrollServiceActions({
          host: () => true,
          href: () => 'https://www.crunchyroll.com/pl/watch/G50UZ4E20/asta'
        }).read();
        return {
          intro, sought, afterSeek, seekClicks, middle, stale, visible, skipClicks, credits, preview, ending, finished, nextActivated, nextClicks,
          foreignWindows, flagged, otherEpisode
        };
      })()`) as {
        intro: Array<{ id: string; label: string }>;
        sought: boolean;
        afterSeek: number;
        seekClicks: number;
        middle: Array<{ label: string }>;
        stale: Array<{ label: string }>;
        visible: Array<{ label: string }>;
        skipClicks: number;
        credits: Array<{ id: string; label: string }>;
        preview: Array<{ label: string }>;
        ending: Array<{ label: string }>;
        finished: Array<{ label: string }>;
        nextActivated: boolean;
        nextClicks: number;
        foreignWindows: Array<{ label: string }>;
        flagged: unknown[];
        otherEpisode: unknown[];
      };
      assert.deepEqual(report.intro.map(action => action.label), ['Pomiń czołówkę']);
      assert.match(report.intro[0].id, /crunchyroll:skip\|GPWUKZGZX\|intro\|0\|90\|/);
      assert.equal(report.sought, true);
      assert.equal(report.afterSeek, 90);
      assert.equal(report.seekClicks, 0);
      assert.deepEqual(report.middle, []);
      assert.deepEqual(report.stale, []);
      assert.equal(report.visible[0].label, 'Pomiń czołówkę');
      assert.equal(report.skipClicks, 1);
      assert.deepEqual(report.credits.map(action => action.label), ['Pomiń napisy', 'Następny odcinek']);
      assert.match(report.credits[0].id, /\|credits\|1265\|1355\|/);
      assert.deepEqual(report.preview.map(action => action.label), ['Pomiń zajawkę', 'Następny odcinek']);
      assert.deepEqual(report.ending.map(action => action.label), ['Pomiń zajawkę', 'Następny odcinek']);
      assert.deepEqual(report.finished.map(action => action.label), ['Następny odcinek']);
      assert.equal(report.nextActivated, true);
      assert.equal(report.nextClicks, 1);
      assert.deepEqual(report.foreignWindows, []);
      assert.deepEqual(report.flagged, []);
      assert.deepEqual(report.otherEpisode, []);
    } finally {
      await browser.close();
    }
  });
});
