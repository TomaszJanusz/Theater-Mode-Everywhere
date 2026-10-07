import { readStylesheet } from '../test-utils/styles';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);

function compile(relativePath: string, globalName: string): string {
  const esbuild = require('esbuild') as { buildSync(options: object): {outputFiles: Array<{text: string}>} };
  return esbuild.buildSync({
    entryPoints: [new URL(relativePath, import.meta.url).pathname], bundle: true,
    write: false, format: 'iife', globalName, platform: 'browser', target: 'es2022', logLevel: 'silent'
  }).outputFiles[0].text;
}

function esbuildBundle(): string {
  const esbuild = require('esbuild') as {
    buildSync: (options: {
      entryPoints: string[];
      bundle: boolean;
      write: boolean;
      format: 'iife';
      platform: 'browser';
      target: string;
      logLevel: 'silent';
    }) => { outputFiles: Array<{ text: string }> };
  };
  const result = esbuild.buildSync({
    entryPoints: [new URL('../entries/main-world.ts', import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent'
  });
  return result.outputFiles[0].text;
}

describe('netflix runtime browser regressions', () => {
  it('hides ancestor videos, rebinds after a style-only hide, restores mask longhands, and boots MAIN without a player id', async () => {
    let executable = '';
    const { chromium } = await import('playwright');
    try {
      executable = chromium.executablePath();
    } catch {
      return;
    }
    if (!existsSync(executable)) return;

    const playback = compile('../providers/netflix/playback.ts', 'NetflixPlayback');
    const stage = compile('../providers/netflix/stage.ts', 'NetflixStage');
    const shadowClick = compile('../providers/netflix/shadow-click.ts', 'NetflixShadowClick');
    const bundle = esbuildBundle();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.setDefaultTimeout(4000);
      await page.setContent(`<!doctype html><style>
        video { display: block; width: 100%; height: 100%; }
        #hidden-hero { width: 400px; height: 220px; visibility: hidden; }
        #modal-wrap { width: 420px; height: 236px; opacity: 1; }
        #visible { width: 320px; height: 180px; }
      </style><body>
        <div id="hidden-hero"><video id="hero"></video></div>
        <div id="modal-wrap" class="nf-player-container"><video id="modal"></video></div>
        <video id="visible"></video>
        <div id="shell" style="position:fixed; will-change: transform; mask-image: linear-gradient(#000, transparent); background-image: linear-gradient(#111, #222); background-color: rgb(1, 2, 3);"><video id="pinned"></video></div>
      </body>`, { waitUntil: 'domcontentloaded' });
      await page.addScriptTag({
        content: `${playback}\n${stage}\nwindow.__nf = { ...NetflixPlayback, ...NetflixStage };`,
        type: 'module'
      });

      const facts = await page.evaluate(`(() => {
        const api = window.__nf;
        return {
          hero: api.readNetflixVideoFacts(document.querySelector('#hero')).usable,
          modal: api.readNetflixVideoFacts(document.querySelector('#modal')).usable,
          visible: api.readNetflixVideoFacts(document.querySelector('#visible')).usable
        };
      })()`) as { hero: boolean; modal: boolean; visible: boolean };
      assert.equal(facts.hero, false);
      assert.equal(facts.modal, true);
      assert.equal(facts.visible, true);

      const switched = await page.evaluate(`(async () => {
        const api = window.__nf;
        const modal = document.querySelector('#modal');
        const visible = document.querySelector('#visible');
        let active = modal;
        const stabilized = [];
        const binding = api.createNetflixVideoBinding({
          root: document.documentElement,
          current: () => active,
          pick: () => [...document.querySelectorAll('video')].sort((left, right) => (
            api.netflixPlaybackRank(api.readNetflixVideoFacts(right))
            - api.netflixPlaybackRank(api.readNetflixVideoFacts(left))
          ))[0],
          shouldSwitch: (current, next) => api.shouldFollowNetflixVideo(
            api.readNetflixVideoFacts(current),
            api.readNetflixVideoFacts(next)
          ),
          onSwitch: (next) => { active = next; },
          onStabilize: (video) => { stabilized.push(video.id); }
        });
        binding.bind(modal);
        document.querySelector('#modal-wrap').style.visibility = 'hidden';
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        modal.dispatchEvent(new Event('loadedmetadata'));
        visible.dispatchEvent(new Event('loadedmetadata'));
        return { id: binding.listeningTo()?.id || '', stabilized };
      })()`) as { id: string; stabilized: string[] };
      assert.equal(switched.id, 'visible');
      assert.deepEqual(switched.stabilized, ['visible']);

      const restored = await page.evaluate(`(() => {
        const shell = document.querySelector('#shell');
        const before = {
          mask: shell.style.getPropertyValue('mask-image'),
          willChange: shell.style.getPropertyValue('will-change'),
          backgroundImage: shell.style.getPropertyValue('background-image'),
          backgroundColor: shell.style.getPropertyValue('background-color')
        };
        window.__nf.holdNetflixViewport(document.querySelector('#pinned'));
        const held = shell.style.getPropertyValue('will-change');
        window.__nf.releaseNetflixViewport();
        return {
          before,
          held,
          after: {
            mask: shell.style.getPropertyValue('mask-image'),
            willChange: shell.style.getPropertyValue('will-change'),
            backgroundImage: shell.style.getPropertyValue('background-image'),
            backgroundColor: shell.style.getPropertyValue('background-color')
          }
        };
      })()`) as {
        before: { mask: string; willChange: string; backgroundImage: string; backgroundColor: string };
        held: string;
        after: { mask: string; willChange: string; backgroundImage: string; backgroundColor: string };
      };
      assert.equal(restored.held, 'auto');
      assert.equal(restored.after.willChange, restored.before.willChange);
      assert.equal(restored.after.mask, restored.before.mask);
      assert.equal(restored.after.backgroundImage, restored.before.backgroundImage);
      assert.equal(restored.after.backgroundColor, restored.before.backgroundColor);
      assert.match(restored.after.mask, /gradient/i);
      assert.match(restored.after.backgroundImage, /gradient/i);

      await page.addScriptTag({
        content: `${shadowClick}\nwindow.relayNetflixShadowClick = NetflixShadowClick.relayNetflixShadowClick;`,
        type: 'module'
      });
      const clicks = await page.evaluate(`(() => {
        const host = document.createElement('div');
        host.id = 'theater-everywhere-ui';
        document.body.appendChild(host);
        const shadow = host.attachShadow({ mode: 'open' });
        const button = document.createElement('button');
        const icon = document.createElement('button');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        svg.append(iconPath);
        icon.append(svg);
        const textButton = document.createElement('button');
        const text = document.createElement('span');
        textButton.append(text);
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        const slider = document.createElement('span');
        label.append(box, slider);
        const anchor = document.createElement('a');
        anchor.href = '#home';
        shadow.append(button, icon, textButton, label, anchor);
        const seen = [];
        let changes = 0;
        let iconClicks = 0;
        let textClicks = 0;
        button.addEventListener('click', (event) => seen.push(event.composed ? 'composed' : 'closed'));
        icon.addEventListener('click', () => { iconClicks += 1; });
        textButton.addEventListener('click', () => { textClicks += 1; });
        box.addEventListener('change', () => { changes += 1; });
        let anchorClicks = 0;
        anchor.addEventListener('click', (event) => {
          anchorClicks += 1;
          event.preventDefault();
        });
        window.addEventListener('click', window.relayNetflixShadowClick, true);
        let swallowed = 0;
        window.addEventListener('click', (event) => {
          if (event.composed) {
            swallowed += 1;
            event.stopImmediatePropagation();
          }
        }, true);
        button.click();
        iconPath.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
        text.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
        box.click();
        const direct = { checked: box.checked, changes };
        box.checked = false;
        changes = 0;
        slider.click();
        const viaSlider = { checked: box.checked, changes };
        const hashBefore = location.hash;
        anchor.click();
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        outside.click();
        return { seen, swallowed, direct, viaSlider, anchorClicks, hash: location.hash, hashBefore, iconClicks, textClicks };
      })()`) as {
        seen: string[];
        swallowed: number;
        direct: { checked: boolean; changes: number };
        viaSlider: { checked: boolean; changes: number };
        anchorClicks: number;
        hash: string;
        hashBefore: string;
        iconClicks: number;
        textClicks: number;
      };
      assert.deepEqual(clicks.seen, ['closed']);
      assert.equal(clicks.iconClicks, 1);
      assert.equal(clicks.textClicks, 1);
      assert.equal(clicks.swallowed, 1);
      assert.equal(clicks.direct.checked, true);
      assert.equal(clicks.direct.changes, 1);
      assert.equal(clicks.viaSlider.checked, true);
      assert.equal(clicks.viaSlider.changes, 1);
      assert.equal(clicks.anchorClicks, 1);
      assert.equal(clicks.hash, clicks.hashBefore);

      const boot = async (html: string): Promise<number> => {
        const bootPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        bootPage.setDefaultTimeout(4000);
        await bootPage.route('https://www.netflix.com/**', (route) => route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: html
        }));
        await bootPage.goto('https://www.netflix.com/pl/title/80057281', { waitUntil: 'domcontentloaded' });
        await bootPage.evaluate(`(() => {
          let count = 0;
          const observer = new MutationObserver((records) => {
            for (const record of records) {
              const target = record.target instanceof Element ? record.target : record.target.parentElement;
              const nodes = [...record.addedNodes, ...record.removedNodes];
              if (target?.id === 'theater-everywhere-netflix-snapshot' || nodes.some((node) => node instanceof Element && node.id === 'theater-everywhere-netflix-snapshot')) {
                count += 1;
              }
            }
          });
          observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
          window.__snapMutations = () => count;
        })()`);
        await bootPage.addScriptTag({ content: bundle });
        const started = Date.now();
        await bootPage.evaluate('document.title');
        assert.ok(Date.now() - started < 2000);
        await bootPage.waitForTimeout(250);
        const mutations = await bootPage.evaluate('window.__snapMutations()') as number;
        await bootPage.close();
        return mutations;
      };

      const heroMutations = await boot('<!doctype html><title>Oglądaj: Stranger Things | Oficjalna witryna Netflix</title><body><video></video></body>');
      const modalMutations = await boot('<!doctype html><title>Oglądaj: Stranger Things | Oficjalna witryna Netflix</title><body><div class="nf-player-container"><video></video></div></body>');
      assert.ok(heroMutations < 8, `hero snapshot mutations ${heroMutations}`);
      assert.ok(modalMutations < 8, `modal snapshot mutations ${modalMutations}`);
    } finally {
      await browser.close();
    }
  });

  it('treats fallback and loading on a return ancestor as unavailable while Off still applies', async () => {
    let executable = '';
    const { chromium } = await import('playwright');
    try {
      executable = chromium.executablePath();
    } catch {
      return;
    }
    if (!existsSync(executable)) return;

    const bundle = esbuildBundle();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.setDefaultTimeout(4000);
      await page.route('https://www.netflix.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><title>Oglądaj: Stranger Things | Oficjalna witryna Netflix</title><body>
          <div class="nf-player-container">
            <div class="PlayerControlsNeo__layout"></div>
            <div class="player-timedtext"></div>
            <video></video>
          </div>
        </body>`
      }));
      await page.goto('https://www.netflix.com/pl/title/80057281', { waitUntil: 'domcontentloaded' });
      await page.evaluate(`(() => {
        const off = {
          trackId: 'T:2:0;1;pl;1;1;0;0;',
          bcp47: 'pl',
          displayName: 'wył.',
          rawTrackType: 'SUBTITLES',
          isForcedNarrative: true,
          isNoneTrack: false
        };
        const polish = {
          trackId: 'T:2:1;1;pl;0;0;0;0;',
          bcp47: 'pl',
          displayName: 'polski',
          rawTrackType: 'SUBTITLES',
          isForcedNarrative: false,
          isNoneTrack: false
        };
        const rawTracks = [off, polish];
        let live = off;
        const sets = [];
        const api = {
          videoId: '82779520',
          textTracks: rawTracks,
          getTimedTextTrackList: () => rawTracks,
          getTimedTextTrack: () => live,
          setTimedTextTrack: (track) => { sets.push(track.displayName); live = track; }
        };
        const blank = () => ({});
        const rootFiber = blank();
        let cursor = rootFiber;
        for (let n = 0; n < 24; n += 1) {
          const child = blank();
          cursor.child = child;
          cursor = child;
        }
        const apiFiber = blank();
        apiFiber.memoizedProps = api;
        cursor.sibling = apiFiber;
        const stale = blank();
        stale.stateNode = { state: { fallbackMode: false, uiState: 'ps' } };
        apiFiber.sibling = stale;
        let parent = rootFiber;
        for (let n = 0; n < 3; n += 1) {
          const next = blank();
          parent.return = next;
          parent = next;
        }
        parent.stateNode = { state: { fallbackMode: true, uiState: 'loading' } };
        const later = blank();
        later.stateNode = { state: { fallbackMode: false, uiState: 'ps' } };
        parent.return = later;
        document.querySelector('.nf-player-container').__reactFiber$ancestor = rootFiber;
        window.__nfSets = sets;
      })()`);
      await page.addScriptTag({ content: bundle });
      const result = await page.evaluate(`(() => {
        const snapshotNode = document.getElementById('theater-everywhere-netflix-snapshot');
        const snapshot = snapshotNode ? JSON.parse(snapshotNode.textContent) : null;
        const request = (requestId, trackId) => {
          let ack = null;
          const onAck = (event) => { ack = JSON.parse(event.detail); };
          window.addEventListener('theater-everywhere-netflix-caption-ack', onAck);
          window.dispatchEvent(new CustomEvent('theater-everywhere-netflix-caption', {
            detail: JSON.stringify({ requestId, trackId })
          }));
          window.removeEventListener('theater-everywhere-netflix-caption-ack', onAck);
          return ack;
        };
        const before = window.__nfSets.slice();
        const language = request('te-nf-langparent1', 'T:2:1;1;pl;0;0;0;0;');
        const afterLanguage = window.__nfSets.slice();
        const off = request('te-nf-offparent01', null);
        return {
          captions: snapshot && snapshot.captions,
          tracks: snapshot && snapshot.tracks.length,
          renderer: document.querySelector('.player-timedtext') instanceof HTMLElement,
          layoutLoading: document.querySelector('.PlayerControlsNeo__layout').classList.contains('PlayerControlsNeo__layout--loading'),
          before,
          language,
          afterLanguage,
          off,
          applied: window.__nfSets.slice()
        };
      })()`) as {
        captions: boolean;
        tracks: number;
        renderer: boolean;
        layoutLoading: boolean;
        before: string[];
        language: { ok?: boolean } | null;
        afterLanguage: string[];
        off: { ok?: boolean } | null;
        applied: string[];
      };
      assert.equal(result.renderer, true);
      assert.equal(result.layoutLoading, false);
      assert.equal(result.captions, false);
      assert.equal(result.tracks, 0);
      assert.equal(result.language?.ok, false);
      assert.deepEqual(result.afterLanguage, result.before);
      assert.equal(result.off?.ok, true);
      assert.deepEqual(result.applied, ['wył.']);
    } finally {
      await browser.close();
    }
  });
  it('boots at document_start and uses the attached signed-in session across captions, seeks, previews and episode changes', async () => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) return;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const bundle = esbuildBundle();
      // An extension MAIN script really runs before <html> exists.
      await page.addInitScript('window.__name = (target) => target;');
      await page.addInitScript(bundle);
      await page.route('https://www.netflix.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>Netflix</title><body><div class="watch-video"><div data-uia="player" data-videoid="70248290"><div id="session-element"><video></video><div class="player-timedtext"></div></div></div></div></body>` }));
      await page.goto('https://www.netflix.com/watch/70248290');
      await page.addStyleTag({ content: readStylesheet(new URL('../content.css', import.meta.url)) });
      const canvas = await page.evaluate(() => {
        document.documentElement.classList.add('theater-everywhere-netflix-stage');
        const video = document.querySelector('video')!;
        video.style.position = 'fixed';
        let parent = video.parentElement;
        while (parent && parent !== document.documentElement) {
          parent.classList.add('theater-everywhere-parent-active');
          parent = parent.parentElement;
        }
        const inner = video.parentElement!;
        inner.style.height = '100%';
        inner.style.width = '100%';
        return { height: inner.getBoundingClientRect().height, viewport: window.innerHeight };
      });
      assert.equal(canvas.height, canvas.viewport, 'Netflix must retain a measurable canvas after the video leaves flow');
      await page.evaluate(() => {
        const off = { trackId: 'T:NONE;', displayName: 'wył.', isNoneTrack: true };
        const polish = { trackId: 'T:pl;', displayName: 'polski', bcp47: 'pl' };
        let selected = off;
        const calls: unknown[] = [];
        let ready = true;
        let currentTime = 90000;
        const player = {
          getMovieId: () => 70248290,
          getElement: () => document.getElementById('session-element'),
          isReady: () => ready,
          getTimedTextTrackList: () => [off, polish],
          getTimedTextTrack: () => selected,
          setTimedTextTrack: (track: typeof off) => { selected = track; calls.push(['caption', track.trackId]); },
          getDuration: () => 2973845,
          getCurrentTime: () => currentTime,
          getTimeCodes: () => [{ type: 'skip_credits', startOffsetMs: 60853, endOffsetMs: 151402 }],
          isPaused: () => true,
          seek: (ms: number) => { currentTime = ms; calls.push(['seek', ms]); },
          play: () => calls.push(['play']),
          pause: () => calls.push(['pause']),
          getTrickPlayFrame: (ms: number) => ({ time: ms, width: 240, height: 108, image: new Uint8Array([255, 216, 255, 217]) })
        };
        const background = { ...player, getMovieId: () => 70248291, getElement: () => document.body };
        Object.assign(window, {
          netflix: { appContext: { state: { playerApp: { getAPI: () => ({
            videoPlayer: { getAllPlayerSessionIds: () => ['background', 'active'], getVideoPlayerBySessionId: (id: string) => id === 'active' ? player : background },
            getVideoMetadataByVideoId: () => ({ getTitle: () => 'House of Cards', getCurrentVideo: () => ({ getEpisodeTitle: () => 'Rozdział 2' }) })
          }) } } } },
          __nfCalls: calls,
          __nfReady: (value: boolean) => { ready = value; }
        });
        const intro = document.createElement('button');
        intro.dataset.uia = 'player-skip-intro';
        intro.textContent = 'Pomiń czołówkę';
        document.querySelector('[data-uia="player"]')!.append(intro);
      });
      await page.waitForFunction(() => document.getElementById('theater-everywhere-netflix-snapshot')?.textContent?.includes('polski'));
      // The native button is removed on idle; the clock-bound action remains.
      await page.evaluate(() => document.querySelector('[data-uia="player-skip-intro"]')!.remove());
      const intro = await page.evaluate(() => JSON.parse(document.getElementById('theater-everywhere-netflix-timed-action')!.textContent!));
      assert.equal(intro.label, 'Pomiń czołówkę');
      assert.equal(intro.id, 'intro:70248290:60853:151402');
      const result = await page.evaluate(() => {
        const snapshot = () => JSON.parse(document.getElementById('theater-everywhere-netflix-snapshot')!.textContent!);
        const request = (trackId: string | null, videoId = '70248290') => {
          let ack: { ok: boolean } | null = null;
          const listener = (event: Event) => { ack = JSON.parse((event as CustomEvent).detail); };
          window.addEventListener('theater-everywhere-netflix-caption-ack', listener);
          window.dispatchEvent(new CustomEvent('theater-everywhere-netflix-caption', { detail: JSON.stringify({ requestId: 'te-nf-watchtest01', trackId, videoId }) }));
          window.removeEventListener('theater-everywhere-netflix-caption-ack', listener);
          return ack as { ok: boolean } | null;
        };
        const before = snapshot();
        const stale = request('T:pl;', '70248291');
        const language = request('T:pl;');
        const selected = snapshot().selectedTrackId;
        window.dispatchEvent(new CustomEvent('theater-everywhere-media-seek', { detail: { time: 152.25, resumeAfterSeek: false } }));
        window.dispatchEvent(new CustomEvent('theater-everywhere-netflix-preview', { detail: JSON.stringify({ videoId: '70248290', time: 120 }) }));
        const preview = JSON.parse(document.getElementById('theater-everywhere-netflix-preview-frame')!.textContent!);
        const off = request(null);
        return { before, stale, language, selected, preview, off, calls: (window as any).__nfCalls };
      });
      assert.equal(result.before.videoId, '70248290');
      assert.equal(result.before.title, 'House of Cards · Rozdział 2');
      assert.equal(result.before.captions, true);
      assert.equal(result.before.previews, true);
      assert.equal(result.stale?.ok, false);
      assert.equal(result.language?.ok, true);
      assert.equal(result.selected, 'T:pl;');
      assert.equal(result.off?.ok, true);
      assert.equal(result.preview.url, 'data:image/jpeg;base64,/9j/2Q==');
      assert.deepEqual(result.calls, [['caption', 'T:pl;'], ['seek', 152250], ['pause'], ['caption', 'T:NONE;']]);
      const timedAction = await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('theater-everywhere-media-seek', { detail: { time: 90, resumeAfterSeek: false } }));
        const id = 'intro:70248290:60853:151402';
        const acks: string[] = [];
        window.addEventListener('theater-everywhere-netflix-action-ack', event => acks.push((event as CustomEvent).detail));
        window.dispatchEvent(new CustomEvent('theater-everywhere-netflix-action', { detail: 'intro:70248291:60853:151402' }));
        window.dispatchEvent(new CustomEvent('theater-everywhere-netflix-action', { detail: id }));
        window.dispatchEvent(new CustomEvent('theater-everywhere-netflix-action', { detail: id }));
        return { acks, calls: (window as any).__nfCalls.slice(-4) };
      });
      assert.deepEqual(timedAction.acks, ['no:intro:70248291:60853:151402', 'ok:intro:70248290:60853:151402', 'no:intro:70248290:60853:151402']);
      assert.deepEqual(timedAction.calls, [['seek', 90000], ['pause'], ['seek', 151402], ['pause']]);
      await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'theater-everywhere-ui';
        document.body.append(host);
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<div class="theater-service-action-host"><button>Action</button></div>';
        (window as any).__actionKeys = 0;
        shadow.querySelector('button')!.addEventListener('click', () => { (window as any).__actionKeys++; });
        // Netflix's host listener would cancel native activation at window capture.
        const cancelSpace = (event: KeyboardEvent) => { if (event.key === ' ') event.preventDefault(); };
        window.addEventListener('keydown', cancelSpace, true);
        window.addEventListener('keyup', cancelSpace, true);
      });
      await page.locator('.theater-service-action-host button').focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => (window as any).__actionKeys), 2);
      await page.evaluate(() => { history.pushState({}, '', '/watch/70248291'); });
      await page.waitForFunction(() => JSON.parse(document.getElementById('theater-everywhere-netflix-snapshot')!.textContent!).videoId === '70248291');
      const changed = await page.evaluate(() => JSON.parse(document.getElementById('theater-everywhere-netflix-snapshot')!.textContent!));
      // The background session deliberately does not belong to the player root.
      assert.equal(changed.captions, false);
      assert.deepEqual(changed.tracks, []);
      assert.equal(changed.title, undefined);
    } finally { await browser.close(); }
  });

});
