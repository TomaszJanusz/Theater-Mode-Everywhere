import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(path.join(SRC, 'content.css'), 'utf8');

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
  it('reads live Netflix controls and keeps one CTA through stale clicks and disposal', async () => {
    let executable = '';
    const { chromium } = await import('playwright');
    try {
      executable = chromium.executablePath();
    } catch {
      return;
    }
    if (!existsSync(executable)) return;

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.setDefaultTimeout(4000);
      await page.setContent('<!doctype html><body></body>', { waitUntil: 'domcontentloaded' });
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
        const readLabel = () => source.read()?.label || null;
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
        const live = source.read();
        document.documentElement.setAttribute('data-te-netflix-integration-off', '');
        report.flagOff = source.read()?.label || null;
        const flagClicks = arm(root.querySelector('button'));
        source.activate(live.id);
        report.flagOff = (report.flagOff || '') + ':' + flagClicks();
        document.documentElement.removeAttribute('data-te-netflix-integration-off');
        const otherHost = create({ host: () => false, href: () => href });
        report.hostOff = otherHost.read()?.label || null;

        href = 'https://www.netflix.com/watch/70248290?trackId=13752289';
        const queried = source.read();
        href = 'https://www.netflix.com/watch/70248290';
        const stable = source.read();
        report.queryIgnored = Boolean(queried && stable && queried.id === stable.id);

        const videoButton = root.querySelector('button');
        const videoClicks = arm(videoButton);
        const videoId = source.read().id;
        root.setAttribute('data-videoid', '80000000');
        report.videoStale = source.activate(videoId) === false && source.read() === null;
        report.videoClicks = videoClicks();
        root.setAttribute('data-videoid', '70248290');

        const urlId = source.read().id;
        href = 'https://www.netflix.com/watch/80057281';
        report.urlStale = source.activate(urlId) === false && source.read() === null;
        report.urlClicks = videoClicks();
        href = 'https://www.netflix.com/watch/70248290';

        const current = root.querySelector('button');
        const currentId = source.read().id;
        const replacement = current.cloneNode(true);
        const replacedClicks = arm(replacement);
        current.replaceWith(replacement);
        report.replacedStale = source.activate(currentId) === false;
        report.replacedClicks = replacedClicks();
        const fresh = source.read();
        source.activate(fresh.id);
        report.singleClick = replacedClicks();

        const gone = root.querySelector('button');
        const goneId = source.read().id;
        const goneClicks = arm(gone);
        gone.remove();
        report.removedClicks = source.activate(goneId) === false ? goneClicks() : -1;

        const disabledRoot = player('<button data-uia="player-skip-intro">Pomiń czołówkę</button>');
        const disabledButton = disabledRoot.querySelector('button');
        const disabledId = source.read().id;
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
      assert.equal(discovered.nextHidden, 'Następny odcinek');
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
        await new Promise((resolve) => setTimeout(resolve, 120));
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
      await page.waitForTimeout(80);
      assert.equal(await page.locator('.theater-service-action').count(), 0);
      const afterDispose = await page.evaluate('window.__ctaClicks') as number;
      await page.waitForTimeout(80);
      assert.equal(await page.evaluate('window.__ctaClicks') as number, afterDispose);
    } finally {
      await browser.close();
    }
  });
});
