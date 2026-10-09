import { readStylesheet } from '../test-utils/styles';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readStylesheet(path.join(SRC, 'content.css'));

type Esbuild = {
  buildSync: (options: {
    stdin?: { contents: string; resolveDir: string; sourcefile: string; loader: 'ts' };
    entryPoints?: string[];
    bundle: boolean;
    write: boolean;
    format: 'iife';
    globalName: string;
    platform: 'browser';
    target: string;
    logLevel: 'silent';
  }) => { outputFiles: Array<{ text: string }> };
};

function bundle(options: {
  globalName: string;
  stdin?: { contents: string; resolveDir: string; sourcefile: string; loader: 'ts' };
  entryPoints?: string[];
}): string {
  const esbuild = require('esbuild') as Esbuild;
  return esbuild.buildSync({
    bundle: true,
    write: false,
    format: 'iife',
    globalName: options.globalName,
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent',
    ...(options.stdin ? { stdin: options.stdin } : { entryPoints: options.entryPoints })
  }).outputFiles[0].text;
}

const uiBundle = bundle({
  globalName: 'TeServiceActions',
  stdin: {
    contents: [
      "export { DisposableScope } from './core/disposable-scope.ts';",
      "export { createToolbar } from './ui/toolbar.ts';",
      "export { createNetflixHostCaptions } from './providers/netflix/host-captions.ts';",
      "export { mountServiceActionCta } from './ui/service-actions.ts';"
    ].join('\n'),
    resolveDir: SRC,
    sourcefile: 'service-actions-browser-entry.ts',
    loader: 'ts'
  }
});

const netflixBundle = bundle({
  globalName: 'TeNetflixServiceActions',
  entryPoints: [path.join(SRC, 'providers/netflix/service-actions.ts')]
});

const shadowBundle = bundle({
  globalName: 'TeShadow',
  entryPoints: [path.join(SRC, 'providers/netflix/shadow-click.ts')]
});

type NetflixReport = {
  label: string | null;
  nextHidden: string | null;
  recap: string | null;
  credits: string | null;
  seamless: string | null;
  postplayButton: string | null;
  postplayAnchor: string | null;
  postplayAction: string | null;
  watchCredits: string | null;
  priority: string | null;
  outside: string | null;
  plain: string | null;
  disabled: string | null;
  ariaDisabled: string | null;
  displayNone: string | null;
  ancestorDisplayNone: string | null;
  hiddenAttr: string | null;
  visibilityHidden: string | null;
  opacityHidden: string | null;
  flagOff: string | null;
  hostOff: string | null;
  queryIgnored: boolean;
  videoStale: boolean;
  videoClicks: number;
  urlStale: boolean;
  urlClicks: number;
  replacedStale: boolean;
  replacedClicks: number;
  removedClicks: number;
  disabledClicks: number;
  singleClick: number;
  sameWatchQuery: boolean;
};

describe('service action CTA', () => {
  it('renders and activates an arbitrary provider through the shared action contract', async t => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) { t.skip('Chromium is not installed'); return; }
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent('<div id="player"></div>');
      await page.addScriptTag({ content: uiBundle });
      await page.evaluate(`(() => {
        const scope = new TeServiceActions.DisposableScope();
        window.__actions = [{id:'extras:42', label:'Zobacz dodatki', progress:0.4}, {id:'dismiss:42', label:'Zamknij'}];
        window.__activated = [];
        window.__layout = 0;
        TeServiceActions.mountServiceActionCta(scope, {
          source:{read:()=>window.__actions, activate:id=>{window.__activated.push(id);window.__actions=window.__actions.filter(a=>a.id!==id);return true;}},
          mount:el=>document.getElementById('player').append(el), toolbarVisible:()=>false,
          subscribeToolbar:()=>()=>{}, controlsLift:()=>0, pollMs:20,
          onLayout:()=>{ window.__layout++; }
        });
        window.__genericActionScope = scope;
      })()`);
      assert.deepEqual(await page.locator('.theater-service-action').allTextContents(), ['Zobacz dodatki', 'Zamknij']);
      const layoutBefore = await page.evaluate('window.__layout') as number;
      await page.getByRole('button', {name:'Zobacz dodatki'}).focus();
      await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate('window.__activated'), ['extras:42']);
      assert.deepEqual(await page.locator('.theater-service-action').allTextContents(), ['Zamknij']);
      const layoutAfterAction = await page.evaluate('window.__layout') as number;
      assert.ok(layoutBefore >= 1 && layoutAfterAction > layoutBefore);
      await page.evaluate('window.__genericActionScope.dispose()');
      assert.equal(await page.locator('.theater-service-action-host').count(), 0);
      const layoutAfterDispose = await page.evaluate('window.__layout') as number;
      assert.ok(layoutAfterDispose > layoutAfterAction);
    } finally { await browser.close(); }
  });

  it('redocks native cue replacements before paint, restores overwritten motion and disconnects on exit', async t => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) { t.skip('Chromium is not installed'); return; }
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.setContent('<div class="watch-video"><div data-uia="player"><div data-uia="video-canvas"><video></video><div class="player-timedtext"></div></div></div></div>');
      await page.addStyleTag({ content: CSS });
      await page.addScriptTag({ content: uiBundle });
      const report = await page.evaluate(`(async () => {
        document.documentElement.className = 'theater-everywhere-netflix-stage theater-everywhere-picture-top';
        const video = document.querySelector('video');
        Object.defineProperties(video, { videoWidth: {value:1920}, videoHeight: {value:1080} });
        video.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh';
        const scope = new TeServiceActions.DisposableScope();
        const captions = TeServiceActions.createNetflixHostCaptions(document);
        const features = { readHostCaptionLayout:()=>captions.read(), setCaptionLineLimit:()=>{} };
        const controls = document.createElement('div');
        controls.className = 'theater-controls-wrapper';
        controls._mediaFeatures = features;
        document.body.append(controls);
        const chromeContext = {
          session:{element:video,currentEpoch:1,isIdle:false,isExiting:false},
          queryPlayerUi:selector=>document.querySelector(selector),
          queryPlayerUiAll:selector=>Array.from(document.querySelectorAll(selector))
        };
        const toolbar = TeServiceActions.createToolbar(chromeContext);
        scope.add(()=>toolbar.resetCaptionDock());
        const host = document.querySelector('.player-timedtext');
        let calls=0;
        scope.add(captions.observe(()=>{ calls++; toolbar.updateCaptionDock(true); }));
        const replace = async text => {
          host.style.cssText = 'display:block';
          host.innerHTML = '<div class="player-timedtext-text-container"><span>' + text + '</span></div>';
          await new Promise(resolve=>requestAnimationFrame(resolve));
          return {bottom:document.documentElement.style.getPropertyValue('--theater-caption-bottom'), transition:host.style.transition, height:host.offsetHeight, background:getComputedStyle(host.querySelector('span')).backgroundColor};
        };
        const one = await replace('One line');
        const two = await replace('Two lines<br>Second line');
        const next = await replace('Next line');
        const cue = host.querySelector('span');
        document.documentElement.style.setProperty('--theater-caption-bg', 'rgba(12, 34, 56, 0.8)');
        document.documentElement.style.setProperty('--theater-caption-bg-alpha', '0.6');
        const raisedBackground = getComputedStyle(cue).backgroundColor;
        document.documentElement.classList.remove('theater-everywhere-picture-top');
        const configuredBackground = getComputedStyle(cue).backgroundColor;
        document.documentElement.classList.add('theater-everywhere-picture-top');
        document.documentElement.style.removeProperty('--theater-caption-bg');
        document.documentElement.style.removeProperty('--theater-caption-bg-alpha');
        const rule = document.createElement('style');
        rule.textContent = '.player-timedtext { transition: bottom 0.18s ease !important; }';
        document.head.append(rule);
        const obstacle = document.createElement('div');
        obstacle.className = 'theater-service-action-host';
        obstacle.style.setProperty('left', '400px', 'important');
        obstacle.style.setProperty('width', '480px', 'important');
        obstacle.style.setProperty('max-width', 'none', 'important');
        obstacle.style.setProperty('inset-inline-end', 'auto', 'important');
        obstacle.style.setProperty('bottom', '0px', 'important');
        obstacle.style.setProperty('height', '200px', 'important');
        document.body.append(obstacle);
        const liftedToolbar = TeServiceActions.createToolbar(chromeContext);
        scope.add(()=>liftedToolbar.resetCaptionDock());
        liftedToolbar.updateCaptionDock(true);
        const lifted = {
          bottom: document.documentElement.style.getPropertyValue('--theater-caption-bottom'),
          transition: host.style.getPropertyValue('transition'),
          priority: host.style.getPropertyPriority('transition'),
          computed: getComputedStyle(host).transition
        };
        document.documentElement.setAttribute('data-te-netflix-integration-off', '');
        const flagOff = captions.read() !== null;
        const replacement = host.cloneNode(false);
        host.replaceWith(replacement);
        await new Promise(resolve=>requestAnimationFrame(resolve));
        const emptyReplacement = captions.read();
        replacement.innerHTML = '<div class="player-timedtext-text-container"><span>New renderer</span></div>';
        await new Promise(resolve=>requestAnimationFrame(resolve));
        const newRenderer = captions.read();
        const observesReplacement = calls === 5;
        scope.dispose(); const before=calls;
        replacement.innerHTML = '<div class="player-timedtext-text-container"><span>After exit</span></div>';
        await new Promise(resolve=>requestAnimationFrame(resolve));
        return {one,two,next, raisedBackground, configuredBackground, lifted, flagOff, emptyReplacement, newRenderer:!!newRenderer, observesReplacement, before,after:calls};
      })()`) as { one:{bottom:string;transition:string;height:number;background:string}; two:{bottom:string;transition:string;height:number;background:string}; next:{bottom:string;transition:string;height:number;background:string}; raisedBackground:string; configuredBackground:string; lifted:{bottom:string;transition:string;priority:string;computed:string}; flagOff:boolean; emptyReplacement:unknown; newRenderer:boolean; observesReplacement:boolean; before:number;after:number };
      assert.equal(report.one.background, 'rgba(0, 0, 0, 0.8)');
      assert.equal(report.raisedBackground, 'rgba(0, 0, 0, 0.6)');
      assert.equal(report.configuredBackground, 'rgba(12, 34, 56, 0.8)');
      assert.equal(report.one.bottom, '13px', JSON.stringify(report));
      assert.equal(report.two.bottom, '8px');
      assert.equal(report.next.bottom, report.one.bottom);
      assert.equal(report.one.transition, 'opacity 0.15s');
      assert.equal(report.two.transition, report.one.transition);
      assert.equal(report.next.transition, report.one.transition);
      assert.ok(Number.parseFloat(report.lifted.bottom) > Number.parseFloat(report.next.bottom), JSON.stringify(report.lifted));
      assert.equal(report.lifted.transition, 'none');
      assert.equal(report.lifted.priority, 'important');
      assert.equal(report.lifted.computed.includes('0.18s'), false);
      assert.ok(report.two.height > report.one.height);
      assert.equal(report.flagOff, true, 'native presentation remains available with the data integration off');
      assert.equal(report.emptyReplacement, null, 'a replacement renderer cannot reuse the previous host geometry');
      assert.equal(report.newRenderer, true);
      assert.equal(report.observesReplacement, true, 'observation survives replacement of the host caption renderer');
      assert.equal(report.before, 5);
      assert.equal(report.after, report.before);
    } finally { await browser.close(); }
  });

  it('shows both postplay actions, mirrors the native countdown and clears open menus without restarting it', async t => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) { t.skip('Chromium is not installed'); return; }
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.setContent(`<div class="watch-video"><div data-uia="player" data-videoid="70248290">
        <button data-uia="control-next" aria-label="Następny odcinek"></button>
        <button data-uia="watch-credits-seamless-button">Wyświetl napisy końcowe</button>
        <button data-uia="next-episode-seamless-button-draining"><div class="inner" style="width:200px;height:36px;transform:translateX(-100%);transition:transform 1s linear"></div><span>Następny odcinek</span></button>
      </div></div>`);
      await page.addScriptTag({ content: uiBundle });
      await page.addScriptTag({ content: netflixBundle });
      await page.evaluate(`(css => {
        const native = document.querySelector('[data-uia="next-episode-seamless-button-draining"]');
        window.__postplayClicks = [];
        native.addEventListener('click', () => window.__postplayClicks.push('next'));
        document.querySelector('[data-uia="watch-credits-seamless-button"]').addEventListener('click', () => window.__postplayClicks.push('credits'));
        const uiHost = document.createElement('div');
        uiHost.id = 'theater-everywhere-ui';
        document.body.append(uiHost);
        const shadow = uiHost.attachShadow({mode:'open'});
        shadow.innerHTML = '<style>' + css + '</style>';
        const scope = new window.TeServiceActions.DisposableScope();
        window.__postplayScope = scope;
        window.__menuOpen = false;
        const source = window.TeNetflixServiceActions.createNetflixServiceActions({host:()=>true,href:()=> 'https://www.netflix.com/watch/70248290'});
        window.TeServiceActions.mountServiceActionCta(scope, {
          source, mount:node=>shadow.append(node), toolbarVisible:()=>true,
          controlsLift:()=>80, subscribeToolbar:()=>()=>{}, menuOpen:()=>window.__menuOpen, pollMs:20
        });
        const fill = native.querySelector('.inner');
        void fill.offsetWidth;
        fill.style.transform = 'translateX(0)';
      })(${JSON.stringify(CSS)})`);
      assert.deepEqual(await page.locator('.theater-service-action').allTextContents(), ['Następny odcinek', 'Wyświetl napisy końcowe']);
      await page.waitForFunction(() => {
        const fill = document.querySelector('[data-uia="next-episode-seamless-button-draining"] .inner');
        const animation = fill?.getAnimations()[0];
        return animation && (animation.effect?.getComputedTiming().progress ?? 0) > 0.1;
      });
      const paused = await page.evaluate(`(() => {
        const fill = document.querySelector('[data-uia="next-episode-seamless-button-draining"] .inner');
        const animation = fill.getAnimations()[0];
        animation.pause();
        window.__nativeCountdown = animation;
        const root = document.getElementById('theater-everywhere-ui').shadowRoot;
        window.__originalPostplayButton = root.querySelector('.theater-service-action');
        window.__menuOpen = true;
        return animation.effect.getComputedTiming().progress;
      })()`) as number;
      await page.locator('.theater-service-action').first().waitFor({ state: 'hidden' });
      await page.evaluate('window.__menuOpen = false');
      await page.locator('.theater-service-action').first().waitFor({ state: 'visible' });
      const mirrored = await page.evaluate(`(() => {
        const root = document.getElementById('theater-everywhere-ui').shadowRoot;
        const button = root.querySelector('.theater-service-action');
        const progress = new DOMMatrixReadOnly(getComputedStyle(button.querySelector('.theater-service-action-progress')).transform).m11;
        return {progress, same:button===window.__originalPostplayButton, native:window.__nativeCountdown.effect.getComputedTiming().progress, clicks:window.__postplayClicks};
      })()`) as { progress: number; same: boolean; native: number; clicks: string[] };
      assert.ok(Math.abs(mirrored.progress - paused) < 0.03);
      assert.ok(Math.abs(mirrored.progress - mirrored.native) < 0.01);
      assert.equal(mirrored.same, true, 'polls/menu changes retain the same button');
      assert.deepEqual(mirrored.clicks, [], 'RTE never advances the episode itself');
      await page.evaluate('window.__nativeCountdown.play(); window.__nativeCountdown.finished');
      assert.deepEqual(await page.evaluate('window.__postplayClicks'), [], 'native countdown completion does not invoke a second RTE action');
      await page.locator('.theater-service-action').filter({ hasText: 'Wyświetl napisy końcowe' }).click();
      assert.deepEqual(await page.evaluate('window.__postplayClicks'), ['credits']);
      await page.evaluate('window.__postplayScope.dispose()');
      assert.equal(await page.locator('.theater-service-action').count(), 0);
    } finally { await browser.close(); }
  });
  it('reads live Netflix controls and keeps one CTA through stale clicks and disposal', async t => {
    let executable = '';
    const { chromium } = await import('playwright');
    try {
      executable = chromium.executablePath();
    } catch {
      t.skip('Chromium is unavailable');
      return;
    }
    if (!existsSync(executable)) { t.skip('Chromium is not installed'); return; }

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.setDefaultTimeout(4000);
      await page.setContent('<!doctype html><body></body>', { waitUntil: 'domcontentloaded' });
      await page.clock.install();
      await page.exposeFunction('__advanceCtaClock', () => page.clock.runFor(120));
      await page.addScriptTag({ content: uiBundle });
      await page.addScriptTag({ content: netflixBundle });
      await page.addScriptTag({ content: shadowBundle });

      const discovered = await page.evaluate(`(() => {
        const create = window.TeNetflixServiceActions.createNetflixServiceActions;
        let href = 'https://www.netflix.com/watch/70248290';
        const source = create({ host: () => true, href: () => href });
        const player = (inner, videoId = '70248290') => {
          document.body.innerHTML = '<div class="watch-video"><div data-uia="player" data-videoid="' + videoId + '">' + inner + '</div></div>';
          return document.querySelector('[data-uia="player"]');
        };
        const readLabel = () => source.read()[0]?.label || null;
        const skip = '<button data-uia="player-skip-intro"><span>  Pomiń   czołówkę  </span></button>';
        const next = '<button data-uia="control-next" aria-label="Następny odcinek"></button>';
        player(
          '<div class="PlayerControlsNeo__bottom-controls" style="visibility:hidden;opacity:0;pointer-events:none">' + next + '</div>'
          + '<div style="visibility:hidden;opacity:0;pointer-events:none">' + skip + '</div>'
          + '<button data-uia="control-play">Play</button><button>Plain</button>'
        );
        const label = readLabel();
        document.querySelector('[data-uia="player-skip-intro"]').remove();
        const nextHidden = readLabel();
        const probe = (uia, tag = 'button') => {
          player('<' + tag + ' data-uia="' + uia + '">' + uia + '</' + tag + '><button data-uia="control-back">Back</button>');
          return readLabel();
        };
        const report = {
          label,
          nextHidden,
          recap: probe('player-skip-recap'),
          credits: probe('player-skip-credits'),
          seamless: probe('next-episode-seamless-button'),
          postplayButton: probe('next-episode-btn'),
          postplayAnchor: probe('next-episode-btn', 'a'),
          postplayAction: probe('postplay-preview-action'),
          watchCredits: probe('watch-credits-seamless-button'),
          priority: null,
          outside: null,
          plain: null,
          disabled: null,
          ariaDisabled: null,
          displayNone: null,
          ancestorDisplayNone: null,
          hiddenAttr: null,
          visibilityHidden: null,
          opacityHidden: null,
          flagOff: null,
          hostOff: null,
          queryIgnored: false,
          videoStale: false,
          videoClicks: -1,
          urlStale: false,
          urlClicks: -1,
          replacedStale: false,
          replacedClicks: -1,
          removedClicks: -1,
          disabledClicks: -1,
          singleClick: -1,
          sameWatchQuery: false
        };
        player(
          '<button data-uia="watch-credits-seamless-button">Watch credits</button>'
          + '<button data-uia="next-episode-seamless-button">Next episode</button>'
          + '<button data-uia="control-next" aria-label="Następny odcinek"></button>'
        );
        report.priority = readLabel();
        document.body.innerHTML = '<button data-uia="player-skip-intro">Outside</button>'
          + '<div class="watch-video"><div data-uia="player" data-videoid="70248290"></div></div>';
        report.outside = readLabel();
        player('<button>Plain</button><button data-uia="control-play">Play</button>');
        report.plain = readLabel();
        player('<button data-uia="player-skip-intro" disabled>Pomiń czołówkę</button>');
        report.disabled = readLabel();
        player('<button data-uia="player-skip-intro" aria-disabled="true">Pomiń czołówkę</button>');
        report.ariaDisabled = readLabel();
        player('<button data-uia="player-skip-intro" style="display:none">Pomiń czołówkę</button>');
        report.displayNone = readLabel();
        player('<div style="display:none"><button data-uia="player-skip-intro">Pomiń czołówkę</button></div>');
        report.ancestorDisplayNone = readLabel();
        player('<button data-uia="player-skip-intro" hidden>Pomiń czołówkę</button>');
        report.hiddenAttr = readLabel();
        player('<div style="visibility:hidden"><button data-uia="player-skip-intro">Pomiń czołówkę</button></div>');
        report.visibilityHidden = readLabel();
        player('<button data-uia="player-skip-intro" style="opacity:0;pointer-events:none">Pomiń czołówkę</button>');
        report.opacityHidden = readLabel();

        const root = player(skip);
        const live = source.read()[0];
        document.documentElement.setAttribute('data-te-netflix-integration-off', '');
        report.flagOff = source.read()[0]?.label || null;
        const flagClicks = arm(root.querySelector('button'));
        source.activate(live.id);
        report.flagOff = (report.flagOff || '') + ':' + flagClicks();
        document.documentElement.removeAttribute('data-te-netflix-integration-off');
        const otherHost = create({ host: () => false, href: () => href });
        report.hostOff = otherHost.read()[0]?.label || null;

        href = 'https://www.netflix.com/watch/70248290?trackId=13752289';
        const queried = source.read()[0];
        href = 'https://www.netflix.com/watch/70248290';
        const stable = source.read()[0];
        report.queryIgnored = Boolean(queried && stable && queried.id === stable.id);

        const videoButton = root.querySelector('button');
        const videoClicks = arm(videoButton);
        const videoId = source.read()[0].id;
        root.setAttribute('data-videoid', '80000000');
        report.videoStale = source.activate(videoId) === false && source.read().length === 0;
        report.videoClicks = videoClicks();
        root.setAttribute('data-videoid', '70248290');

        const urlId = source.read()[0].id;
        href = 'https://www.netflix.com/watch/80057281';
        report.urlStale = source.activate(urlId) === false && source.read().length === 0;
        report.urlClicks = videoClicks();
        href = 'https://www.netflix.com/watch/70248290';

        const current = root.querySelector('button');
        const currentId = source.read()[0].id;
        const replacement = current.cloneNode(true);
        const replacedClicks = arm(replacement);
        current.replaceWith(replacement);
        report.replacedStale = source.activate(currentId) === false;
        report.replacedClicks = replacedClicks();
        const fresh = source.read()[0];
        source.activate(fresh.id);
        report.singleClick = replacedClicks();

        const gone = root.querySelector('button');
        const goneId = source.read()[0].id;
        const goneClicks = arm(gone);
        gone.remove();
        report.removedClicks = source.activate(goneId) === false ? goneClicks() : -1;

        const disabledRoot = player('<button data-uia="player-skip-intro">Pomiń czołówkę</button>');
        const disabledButton = disabledRoot.querySelector('button');
        const disabledId = source.read()[0].id;
        let disabledInvocations = 0;
        const nativeClick = disabledButton.click.bind(disabledButton);
        disabledButton.click = () => {
          disabledInvocations += 1;
          nativeClick();
        };
        disabledButton.disabled = true;
        const disabledRejected = source.activate(disabledId) === false;
        disabledButton.disabled = false;
        disabledButton.style.display = 'none';
        report.disabledClicks = disabledRejected && source.activate(disabledId) === false ? disabledInvocations : -1;
        return report;

        function arm(button) {
          let clicks = 0;
          button.addEventListener('click', () => { clicks += 1; });
          return () => clicks;
        }
      })()`) as NetflixReport;

      assert.equal(discovered.label, 'Pomiń czołówkę');
      assert.equal(discovered.nextHidden, null, 'navigation toolbar Next is not a contextual service action');
      assert.equal(discovered.recap, 'player-skip-recap');
      assert.equal(discovered.credits, 'player-skip-credits');
      assert.equal(discovered.seamless, 'next-episode-seamless-button');
      assert.equal(discovered.postplayButton, 'next-episode-btn');
      assert.equal(discovered.postplayAnchor, 'next-episode-btn');
      assert.equal(discovered.postplayAction, 'postplay-preview-action');
      assert.equal(discovered.watchCredits, 'watch-credits-seamless-button');
      assert.equal(discovered.priority, 'Next episode');
      assert.equal(discovered.outside, null);
      assert.equal(discovered.plain, null);
      assert.equal(discovered.disabled, null);
      assert.equal(discovered.ariaDisabled, null);
      assert.equal(discovered.displayNone, null);
      assert.equal(discovered.ancestorDisplayNone, null);
      assert.equal(discovered.hiddenAttr, null);
      assert.equal(discovered.visibilityHidden, 'Pomiń czołówkę');
      assert.equal(discovered.opacityHidden, 'Pomiń czołówkę');
      assert.equal(discovered.flagOff, ':0');
      assert.equal(discovered.hostOff, null);
      assert.equal(discovered.queryIgnored, true);
      assert.equal(discovered.videoStale, true);
      assert.equal(discovered.videoClicks, 0);
      assert.equal(discovered.urlStale, true);
      assert.equal(discovered.urlClicks, 0);
      assert.equal(discovered.replacedStale, true);
      assert.equal(discovered.replacedClicks, 0);
      assert.equal(discovered.singleClick, 1);
      assert.equal(discovered.removedClicks, 0);
      assert.equal(discovered.disabledClicks, 0);

      const ui = await page.evaluate(`(async (css) => {
        const { DisposableScope, mountServiceActionCta } = window.TeServiceActions;
        const create = window.TeNetflixServiceActions.createNetflixServiceActions;
        document.body.innerHTML = '<div class="watch-video"><div data-uia="player" data-videoid="70248290">'
          + '<button data-uia="player-skip-intro"><span>Pomiń czołówkę</span></button>'
          + '</div></div>';
        const uiHost = document.createElement('div');
        uiHost.id = 'theater-everywhere-ui';
        document.body.append(uiHost);
        const shadow = uiHost.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = css;
        shadow.append(style);
        const freeze = document.createElement('style');
        freeze.textContent = '.theater-service-action-host { transition: none !important; }';
        shadow.append(freeze);
        let href = 'https://www.netflix.com/watch/70248290';
        const source = create({ host: () => true, href: () => href });
        let toolbar = false;
        const listeners = new Set();
        const scope = new DisposableScope();
        let reads = 0;
        const counting = {
          read() { reads += 1; return source.read(); },
          activate(id) { return source.activate(id); }
        };
        mountServiceActionCta(scope, {
          source: counting,
          mount: (element) => shadow.append(element),
          toolbarVisible: () => toolbar,
          subscribeToolbar: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          controlsLift: () => 120,
          pollMs: 30
        });
        const host = shadow.querySelector('.theater-service-action-host');
        const button = () => shadow.querySelector('.theater-service-action');
        const skip = () => document.querySelector('[data-uia="player-skip-intro"]');
        await waitFor(() => button()?.textContent === 'Pomiń czołówkę');
        const live = host.getAttribute('aria-live');
        const atomic = host.getAttribute('aria-atomic');
        const restingBottom = getComputedStyle(host).bottom;
        const restingPointer = getComputedStyle(button()).pointerEvents;
        const fontSize = getComputedStyle(button()).fontSize;
        toolbar = true;
        for (const listener of listeners) listener();
        const raisedBottom = getComputedStyle(host).bottom;
        const raisedClass = host.classList.contains('toolbar-visible');
        toolbar = false;
        for (const listener of listeners) listener();
        const droppedBottom = getComputedStyle(host).bottom;
        const stillThere = button()?.textContent || '';

        let bubbled = 0;
        const onBubble = (event) => {
          if (event.composedPath().some((node) => node instanceof Element && node.classList.contains('theater-service-action'))) {
            bubbled += 1;
          }
        };
        window.addEventListener('click', onBubble);
        window.addEventListener('click', window.TeShadow.relayNetflixShadowClick, true);
        let skipClicks = 0;
        skip().addEventListener('click', () => { skipClicks += 1; });
        button().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
        const relayClicks = skipClicks;
        const relayBubble = bubbled;
        button().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
        const secondRelay = skipClicks;

        const oldId = button().dataset.serviceActionId;
        const oldSkip = skip();
        const replacement = oldSkip.cloneNode(true);
        let replacementClicks = 0;
        replacement.addEventListener('click', () => { replacementClicks += 1; });
        oldSkip.replaceWith(replacement);
        button().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
        const staleClicks = replacementClicks;
        await waitFor(() => button()?.dataset.serviceActionId && button().dataset.serviceActionId !== oldId);
        button().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
        const freshClicks = replacementClicks;

        let disabledInvocations = 0;
        const nativeClick = replacement.click.bind(replacement);
        replacement.click = () => {
          disabledInvocations += 1;
          return nativeClick();
        };
        replacement.disabled = true;
        button().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
        const disabledClicks = disabledInvocations;
        await waitFor(() => !button());
        const hiddenWhenDisabled = button() === null;
        replacement.disabled = false;
        await waitFor(() => button()?.textContent === 'Pomiń czołówkę');
        replacement.remove();
        button().click();
        await waitFor(() => !shadow.querySelector('.theater-service-action'));
        const hiddenWhenRemoved = shadow.querySelector('.theater-service-action') === null;
        const removedClicks = replacementClicks;

        const beforeDispose = reads;
        scope.dispose();
        await window.__advanceCtaClock();
        return {
          live,
          atomic,
          restingBottom,
          restingPointer,
          fontSize,
          raisedBottom,
          raisedClass,
          droppedBottom,
          stillThere,
          relayClicks,
          relayBubble,
          secondRelay,
          staleClicks,
          freshClicks,
          disabledClicks,
          hiddenWhenDisabled,
          hiddenWhenRemoved,
          removedClicks,
          disposed: !host.isConnected && reads === beforeDispose,
          listeners: listeners.size
        };

        function waitFor(predicate) {
          const start = Date.now();
          return new Promise((resolve, reject) => {
            const tick = () => {
              if (predicate()) resolve();
              else if (Date.now() - start > 1000) reject(new Error('timed out'));
              else setTimeout(tick, 20);
            };
            tick();
          });
        }
      })(${JSON.stringify(CSS)})`) as {
        live: string | null;
        atomic: string | null;
        restingBottom: string;
        restingPointer: string;
        fontSize: string;
        raisedBottom: string;
        raisedClass: boolean;
        droppedBottom: string;
        stillThere: string;
        relayClicks: number;
        relayBubble: number;
        secondRelay: number;
        staleClicks: number;
        freshClicks: number;
        disabledClicks: number;
        hiddenWhenDisabled: boolean;
        hiddenWhenRemoved: boolean;
        removedClicks: number;
        disposed: boolean;
        listeners: number;
      };

      assert.equal(ui.live, 'polite');
      assert.equal(ui.atomic, 'true');
      assert.equal(ui.fontSize, '14px');
      assert.equal(ui.restingPointer, 'auto');
      assert.equal(ui.restingBottom, '24px');
      assert.equal(ui.raisedClass, true);
      assert.equal(ui.raisedBottom, '144px');
      assert.equal(ui.droppedBottom, '24px');
      assert.equal(ui.stillThere, 'Pomiń czołówkę');
      assert.equal(ui.relayClicks, 1);
      assert.equal(ui.secondRelay, 2);
      assert.equal(ui.relayBubble, 0);
      assert.equal(ui.staleClicks, 0);
      assert.equal(ui.freshClicks, 1);
      assert.equal(ui.disabledClicks, 0);
      assert.equal(ui.hiddenWhenDisabled, true);
      assert.equal(ui.hiddenWhenRemoved, true);
      assert.equal(ui.removedClicks, 1);
      assert.equal(ui.disposed, true);
      assert.equal(ui.listeners, 0);

      await page.evaluate(`(() => {
        document.body.innerHTML = '<div class="watch-video"><div data-uia="player" data-videoid="70248290">'
          + '<button data-uia="player-skip-intro">Pomiń czołówkę</button></div></div>';
        const uiHost = document.createElement('div');
        uiHost.id = 'theater-everywhere-ui';
        document.body.append(uiHost);
        const shadow = uiHost.attachShadow({ mode: 'open' });
        window.__ctaClicks = 0;
        const skip = document.querySelector('[data-uia="player-skip-intro"]');
        skip.addEventListener('click', () => { window.__ctaClicks += 1; });
        const { DisposableScope, mountServiceActionCta } = window.TeServiceActions;
        const source = window.TeNetflixServiceActions.createNetflixServiceActions({
          host: () => true,
          href: () => 'https://www.netflix.com/watch/70248290'
        });
        window.__ctaScope = new DisposableScope();
        mountServiceActionCta(window.__ctaScope, {
          source,
          mount: (element) => shadow.append(element),
          toolbarVisible: () => false,
          subscribeToolbar: () => () => {},
          controlsLift: () => 96,
          pollMs: 20
        });
      })()`);
      const cta = page.locator('.theater-service-action');
      await cta.waitFor();
      await cta.focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Space');
      const keys = await page.evaluate('window.__ctaClicks') as number;
      assert.equal(keys, 2);
      await page.evaluate('window.__ctaScope.dispose()');
      await page.locator('.theater-service-action').waitFor({ state: 'detached' });
      const afterDispose = await page.evaluate('window.__ctaClicks') as number;
      await page.clock.runFor(80);
      assert.equal(await page.evaluate('window.__ctaClicks') as number, afterDispose);
    } finally {
      await browser.close();
    }
  });
});
