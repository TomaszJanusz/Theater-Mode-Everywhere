import { selectTestEngines } from '../../test-utils/test-engines';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { build } from 'esbuild';
import { chromium, firefox, type Page } from 'playwright';
import { contrastRatio } from '../../contrast';
import { ownTestBrowser } from '../../test-utils/test-browser';
import { readStylesheet } from '../../test-utils/styles';
import { WHATS_NEW_RELEASE } from '../../whatsNew-release';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const CSS = readStylesheet(path.join(ROOT, 'src/content.css'));
const SHADOW = readStylesheet(path.join(ROOT, 'src/ui/shadow.css'));
const MEDIA = readFileSync(path.join(ROOT, 'test/fixtures/vod.webm'));
const bundle = build({ stdin: { contents: `export { bootstrapPlayerRuntime } from './ui/player-runtime';
export { setPlayerUiCss } from './ui/root';
export { youtubeSponsorBlockSource } from './providers/youtube/sponsorblock';`, resolveDir: path.join(ROOT, 'src'), loader: 'ts' },
  bundle: true, write: false, format: 'iife', globalName: 'SponsorTest', platform: 'browser', target: 'es2022'
}).then(result => result.outputFiles![0].text);

async function boot(page: Page, enabled = true, installed = true, pathname = '/watch?v=first') {
  await page.addInitScript('window.__name = fn => fn');
  await page.route('https://www.youtube.com/**', route => route.fulfill(route.request().url().endsWith('/vod.webm')
    ? { body: MEDIA, contentType: 'video/webm' }
    : { contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><title>SponsorBlock fixture</title>
<style>:root{--sb-category-sponsor:#128aef;--sb-category-text-sponsor:#fff;--sb-category-intro:#00ffff;--sb-category-poi_highlight:#ff1684}
body{margin:0;background:#111}#movie_player{width:960px;height:540px;position:relative}.html5-video-container{position:relative}video{width:960px;height:540px}
.sponsorSkipNoticeParent{position:absolute;bottom:100px;right:10px;z-index:1000;background:#252525;color:white;padding:20px;font:18px sans-serif}</style>
<div id="movie_player"><div class="sponsorSkipNoticeContainer"><div class="sponsorSkipNoticeParent"><button class="sponsorSkipButton">Sponsor skipped · Undo</button></div></div>
<div class="html5-video-container"><video muted src="/vod.webm"></video></div>
<div class="ytp-chrome-bottom"><div id="progress" class="ytp-progress-bar">${installed ? '<ul id="previewbar"><li class="previewbar" sponsorblock-category="sponsor" style="left:10%;right:65%;opacity:.6"></li><li class="previewbar" sponsorblock-category="intro" style="left:2%;right:92%;opacity:.7"></li><li class="previewbar" sponsorblock-category="poi_highlight" style="left:60%;opacity:.7"></li></ul>' : ''}</div></div></div>` }));
  await page.goto(`https://www.youtube.com${pathname}`);
  await page.waitForFunction(() => document.querySelector('video')!.readyState >= 2);
  await page.addStyleTag({ content: CSS });
  await page.evaluate(({ enabled }) => {
    const listeners: Array<(changes: object, area: string) => void> = [];
    Object.assign(window, { chrome: { storage: {
      sync: { get: async () => ({ keepControlsVisible: true, sponsorBlockMarkers: enabled, youtubeIntegrationEnabled: false }), set: async () => {} },
      onChanged: { addListener: (listener: (changes: object, area: string) => void) => listeners.push(listener) }
    } }, changeSponsorSetting: (value: boolean) => listeners.forEach(listener => listener({ sponsorBlockMarkers: { newValue: value } }, 'sync')),
      changeAppearance: (values: Record<string, unknown>) => listeners.forEach(listener => listener(Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])), 'sync')),
      changeYouTubeIntegration: (value: boolean) => listeners.forEach(listener => listener({ youtubeIntegrationEnabled: { newValue: value } }, 'sync')) });
  }, { enabled });
  await page.addScriptTag({ content: await bundle });
  await page.evaluate(`SponsorTest.setPlayerUiCss(${JSON.stringify(SHADOW)}); SponsorTest.bootstrapPlayerRuntime();`);
  await page.keyboard.press('t');
  await page.waitForSelector('.theater-controls-wrapper');
}
const markers = (page: Page) => page.locator('.theater-scrubber-segment');
for (const [name, engine] of selectTestEngines([['Chromium', chromium], ['Firefox', firefox]] as const, ([name]) => name)) {
  it(`${name}: marker borders follow resolved accents and appearance without changing SponsorBlock colors`, { timeout: 60000 }, async t => {
    const browser = await engine.launch(); ownTestBrowser(t, browser);
    const page = await browser.newPage();
    await boot(page);
    await markers(page).first().waitFor();
    for (const highContrast of ['off', 'on']) {
      for (const accentColor of ['blue', 'yellow', 'gray', 'system']) {
        await page.evaluate(values => {
          (window as unknown as { changeAppearance(values: object): void }).changeAppearance(values);
        }, { accentColor, highContrast, reduceTransparency: highContrast });
        await page.waitForFunction(high => document.querySelector<HTMLElement>('#theater-everywhere-ui')!.dataset.contrast === high, highContrast === 'on' ? 'high' : 'normal');
        // Match the actual resolved progress color, including native and high-contrast accents.
        const fill = await page.locator('.theater-scrubber-fill').evaluate(el => getComputedStyle(el).backgroundColor);
        await page.evaluate(color => {
          document.documentElement.style.setProperty('--sb-category-sponsor', color);
          const bar = document.querySelector('#previewbar')!;
          bar.replaceChildren(...Array.from(bar.children).map(child => child.cloneNode(true)));
        }, fill);
        await page.waitForFunction(color => getComputedStyle(document.querySelector('#theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-scrubber-segment')!).backgroundColor === color, fill);
        const marker = await markers(page).first().evaluate(el => {
          const css = getComputedStyle(el);
          return { border: css.borderLeftColor, width: css.borderLeftWidth, style: css.borderLeftStyle,
            background: css.backgroundColor, opacity: css.opacity, box: css.boxSizing };
        });
        const hex = (rgb: string) => '#' + rgb.match(/\d+/g)!.slice(0, 3).map(value => Number(value).toString(16).padStart(2, '0')).join('');
        assert.ok(contrastRatio(hex(marker.border), hex(fill)) >= 3,
          `${accentColor}/${highContrast}: ${marker.border} border must contrast with ${fill} progress by at least 3:1`);
        const tick = await page.locator('.theater-scrubber-chapter-mark').first().evaluate(el => getComputedStyle(el).backgroundColor);
        assert.ok(contrastRatio(hex(tick), hex(fill)) >= 3, `${accentColor}/${highContrast}: bar-colored tick ${tick} must contrast with ${fill} progress`);
        assert.equal(marker.width, '1px');
        assert.equal(marker.style, 'solid');
        assert.equal(marker.box, 'border-box', 'border must not change timeline geometry');
        assert.equal(marker.background, fill, 'retain SponsorBlock category color');
        assert.equal(marker.opacity, '0.6');
      }
    }
    await page.emulateMedia({ forcedColors: 'active' });
    assert.equal(await markers(page).first().evaluate(el => getComputedStyle(el).borderLeftStyle), 'solid');
    await browser.close();
  });
  it(`${name}: rendered views, live settings, navigation, notice stacking and cleanup`, { timeout: 60000 }, async t => {
    const browser = await engine.launch({ headless: true }); ownTestBrowser(t, browser);
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
      await boot(page);
      await markers(page).first().waitFor();
      assert.equal(await markers(page).count(), 3);
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-te-youtube-integration-off')), true);
      await page.evaluate('changeYouTubeIntegration(true)');
      await markers(page).first().waitFor();
      assert.equal(await markers(page).count(), 3);
      assert.equal(await markers(page).first().evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(18, 138, 239)');
      assert.equal(await markers(page).first().evaluate(el => getComputedStyle(el).opacity), '.6'.replace(/^\./, '0.'));
      const notice = page.locator('.sponsorSkipButton');
      assert.equal(await notice.evaluate(el => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x+r.width/2, r.y+r.height/2) === el; }), true, 'notice must be above fixed video and theater chrome');
      if (name === 'Chromium') {
        await page.screenshot({ path: '/tmp/tme57-timeline-markers.png' });
        await page.screenshot({ path: '/tmp/tme57-notice-visible.png' });
      }
      await page.evaluate('changeSponsorSetting(false)');
      await page.waitForFunction(() => !document.querySelector('#theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-scrubber-segment'));
      await page.evaluate('changeSponsorSetting(true)');
      await markers(page).first().waitFor();
      await page.evaluate(() => {
        document.dispatchEvent(new Event('yt-navigate-start'));
        history.pushState({}, '', '/watch?v=second');
      });
      await page.waitForFunction(() => !document.querySelector('#theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-scrubber-segment'));
      await page.evaluate(() => {
        const bar = document.querySelector('#previewbar')!;
        bar.replaceChildren();
        const li = document.createElement('li'); li.className = 'previewbar'; li.setAttribute('sponsorblock-category', 'sponsor');
        li.style.cssText = 'left:45%;right:40%;opacity:.5'; bar.append(li);
        document.dispatchEvent(new Event('yt-navigate-finish'));
      });
      await page.waitForFunction(() => document.querySelector('#theater-everywhere-ui')!.shadowRoot!.querySelector<HTMLElement>('.theater-scrubber-segment')?.style.left === '45%');
      await page.evaluate(() => {
        const style = document.createElement('style'); style.id = 'sbCategoryColorStyle';
        style.textContent = ':root{--sb-category-sponsor: #ffee00;--sb-category-text-sponsor:black}';
        document.head.append(style);
        const bar = document.querySelector('#previewbar')!;
        bar.replaceChildren(...Array.from(bar.children).map(child => child.cloneNode(true)));
      });
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-scrubber-segment')!).backgroundColor === 'rgb(255, 238, 0)');
      await page.evaluate(() => {
        const old = document.querySelector('#previewbar')!;
        const replacement = old.cloneNode(true) as HTMLElement;
        replacement.firstElementChild!.setAttribute('style', 'left:70%;right:10%;opacity:.4');
        old.replaceWith(replacement);
        old.firstElementChild!.setAttribute('style', 'left:5%;right:80%');
        document.dispatchEvent(new Event('yt-player-updated'));
      });
      await page.waitForFunction(() => document.querySelector('#theater-everywhere-ui')!.shadowRoot!.querySelector<HTMLElement>('.theater-scrubber-segment')?.style.left === '70%');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
      assert.equal(await markers(page).count(), 0);
    } finally { await browser.close(); }
  });
}

it('observes only the bar or shallow insertion point; releases stale callbacks', { timeout: 30000 }, async t => {
  const browser = await chromium.launch({ headless: true }); ownTestBrowser(t, browser);
  try {
    const page = await browser.newPage();
    await boot(page, false);
    assert.equal(await markers(page).count(), 0);
    await page.evaluate(`
      window.observedTargets = [];
      window.publishedMarkers = [];
      const original = MutationObserver.prototype.observe;
      MutationObserver.prototype.observe = function(target, options) {
        observedTargets.push(target.id); return original.call(this, target, options);
      };
      window.stopSource = SponsorTest.youtubeSponsorBlockSource(document.querySelector('video')).observe(value => publishedMarkers.push(value));
    `);
    assert.deepEqual(await page.evaluate('observedTargets'), ['previewbar']);
    await page.evaluate(`stopSource(); stopSource(); observedTargets.length = 0; document.querySelector('#previewbar').remove();
      window.stopAbsent = SponsorTest.youtubeSponsorBlockSource(document.querySelector('video')).observe(value => {});`);
    assert.deepEqual(await page.evaluate('observedTargets'), ['progress']);
    await page.evaluate('stopAbsent()');
    await page.evaluate(`window.previousPublications = publishedMarkers.length;
      document.dispatchEvent(new Event('yt-navigate-finish'));`);
    assert.equal(await page.evaluate('publishedMarkers.length === previousPublications'), true);
    await page.keyboard.press('Escape');
    await boot(page, true, false);
    assert.equal(await markers(page).count(), 0);
  } finally { await browser.close(); }
});

it('Features switch has an accessible name, defaults on and persists through shared storage', { timeout: 30000 }, async t => {
  const browser = await chromium.launch({ headless: true }); ownTestBrowser(t, browser);
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const options = await build({ entryPoints: [path.join(ROOT, 'options/options.ts')],
      bundle: true, write: false, format: 'iife', target: 'es2022',
      plugins: [{ name: 'raw-license', setup(build) {
        build.onResolve({ filter: /\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }));
        build.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: 'text' }));
      } }]
    });
    const html = readFileSync(path.join(ROOT, 'options/options.html'), 'utf8').replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');
    await page.route('http://settings.test/**', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('http://settings.test/#features');
    await page.addStyleTag({ content: readStylesheet(path.join(ROOT, 'options/options.css')) });
    await page.evaluate(`localStorage.setItem('whatsNewAcknowledgedId', '${WHATS_NEW_RELEASE.id}');
      window.saved = {}; window.changes = [];
      const storage = {
        get: (keys, callback) => { callback?.(saved); return Promise.resolve(saved); },
        set: async values => { Object.assign(saved, values); changes.forEach(fn => fn(Object.fromEntries(Object.entries(values).map(([key,value]) => [key,{newValue:value}])), 'sync')); }
      };
      window.chrome = {runtime:{getURL: file => file},storage:{sync:storage,onChanged:{addListener:fn => changes.push(fn)}},tabs:{query:async()=>[]}};`);
    await page.addScriptTag({ content: options.outputFiles![0].text });
    const toggle = page.getByRole('checkbox', { name: 'SponsorBlock support', exact: true });
    await toggle.waitFor({ state: 'attached' });
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('#sponsorblock-toggle')!.checked);
    await page.locator('label[for=sponsorblock-toggle]').click();
    assert.equal(await toggle.isChecked(), false);
    await page.waitForFunction('saved.sponsorBlockMarkers === false');
    await toggle.focus();
    await page.keyboard.press('Space');
    assert.equal(await toggle.isChecked(), true);
    await page.waitForFunction('saved.sponsorBlockMarkers === true');
    await page.screenshot({ path: '/tmp/tme57-features-switch.png' });
  } finally { await browser.close(); }
});

it('uses shallow childList observations, coalesces rebuilds, suppresses identical content and suspends when hidden', { timeout: 30000 }, async t => {
  const browser = await chromium.launch({ headless: true }); ownTestBrowser(t, browser);
  try {
    const page = await browser.newPage();
    await boot(page, false);
    await page.evaluate(`
      window.sourceObservations = []; window.sourceDisconnects = 0; window.sourceUpdates = [];
      const NativeObserver = window.MutationObserver;
      window.MutationObserver = class extends NativeObserver {
        observe(target, options) { sourceObservations.push({id:target.id, options}); super.observe(target, options); }
        disconnect() { sourceDisconnects++; super.disconnect(); }
      };
      window.stopLightSource = SponsorTest.youtubeSponsorBlockSource(document.querySelector('video')).observe(value => sourceUpdates.push(value));
    `);
    await page.waitForFunction('sourceUpdates.length === 1');
    assert.deepEqual(await page.evaluate('sourceObservations'), [{ id: 'previewbar', options: { childList: true } }]);
    await page.evaluate(`window.sourceUpdates.length = 0;
      const bar = document.querySelector('#previewbar');
      bar.replaceChildren();
      for (let i=0; i<50; i++) {
        const li = document.createElement('li'); li.className='previewbar';
        li.setAttribute('sponsorblock-category','sponsor'); li.style.cssText='left:10%;right:80%;opacity:.5'; bar.append(li);
      }`);
    await page.waitForFunction('sourceUpdates.length === 1 && sourceUpdates[0].length === 50');
    await page.evaluate(`document.querySelector('#previewbar').replaceChildren(...Array.from(document.querySelector('#previewbar').children).map(child => child.cloneNode(true)));`);
    // Drain both mutation delivery and the coalesced read without sleeping.
    await page.evaluate('new Promise(resolve => requestAnimationFrame(() => resolve()))');
    assert.equal(await page.evaluate('sourceUpdates.length'), 1);
    await page.evaluate(`window.beforeHidden = sourceDisconnects;
      Object.defineProperty(document, 'hidden', {configurable:true,value:true});
      document.dispatchEvent(new Event('visibilitychange'));`);
    assert.equal(await page.evaluate('sourceDisconnects > beforeHidden'), true);
    assert.deepEqual(await page.evaluate('sourceUpdates.at(-1)'), []);
    await page.evaluate(`window.hiddenUpdates=sourceUpdates.length;
      document.querySelector('#previewbar').replaceChildren();`);
    await page.evaluate('new Promise(resolve => requestAnimationFrame(() => resolve()))');
    assert.equal(await page.evaluate('sourceUpdates.length === hiddenUpdates'), true);
    await page.evaluate(`Object.defineProperty(document, 'hidden', {configurable:true,value:false});
      document.dispatchEvent(new Event('visibilitychange'));`);
    assert.deepEqual(await page.evaluate('sourceObservations.at(-1)'), { id: 'previewbar', options: { childList: true } });
    await page.evaluate(`stopLightSource(); stopLightSource(); window.afterStop=sourceDisconnects;
      document.querySelector('#previewbar').remove(); window.sourceObservations.length=0;
      window.stopDiscovery = SponsorTest.youtubeSponsorBlockSource(document.querySelector('video')).observe(value => {});`);
    assert.deepEqual(await page.evaluate('sourceObservations'), [{ id: 'progress', options: { childList: true } }]);
    await page.evaluate(`const bar = document.createElement('ul');bar.id='previewbar';document.querySelector('#progress').prepend(bar);`);
    await page.waitForFunction('sourceObservations.length === 2');
    assert.deepEqual(await page.evaluate('sourceObservations[1]'), { id: 'previewbar', options: { childList: true } });
    await page.evaluate('stopDiscovery()');
    await page.evaluate(`sourceObservations.length=0; window.changeSponsorSetting(true);`);
    await page.waitForFunction('sourceObservations.length > 0');
    await page.evaluate(`window.beforeOff=sourceDisconnects;window.changeSponsorSetting(false);`);
    assert.equal(await page.evaluate('sourceDisconnects > beforeOff'), true);
    await page.evaluate('window.changeSponsorSetting(true)');
    await page.evaluate('window.beforeExit=sourceDisconnects');
    await page.keyboard.press('Escape');
    await page.waitForFunction('sourceDisconnects > beforeExit');
  } finally { await browser.close(); }
});

it('supports the existing YouTube embed player surface', { timeout: 30000 }, async t => {
  const browser = await chromium.launch({ headless: true }); ownTestBrowser(t, browser);
  try {
    const page = await browser.newPage();
    await boot(page, true, true, '/embed/first');
    await markers(page).first().waitFor();
    assert.equal(await markers(page).count(), 3);
    await page.keyboard.press('Escape');
  } finally { await browser.close(); }
});

for (const [name, engine] of selectTestEngines([['Chromium', chromium], ['Firefox', firefox]] as const, ([name]) => name)) {
  it(`${name}: segment bars match the scrubber track height and boundaries get bar-colored ticks`, { timeout: 60000 }, async t => {
    const browser = await engine.launch(); ownTestBrowser(t, browser);
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 3 });
    await boot(page);
    await markers(page).first().waitFor();
    const measure = () => page.evaluate(() => {
      const root = document.querySelector('#theater-everywhere-ui')!.shadowRoot!;
      const rect = (el: Element) => el.getBoundingClientRect();
      const track = rect(root.querySelector('.theater-scrubber-track')!);
      return {
        track: { top: track.top, height: track.height },
        segments: Array.from(root.querySelectorAll('.theater-scrubber-segment')).map(el => ({ top: rect(el).top, height: rect(el).height })),
        ticks: Array.from(root.querySelectorAll<HTMLElement>('.theater-scrubber-chapter-mark')).map(el => el.style.left),
        tickColor: getComputedStyle(root.querySelector('.theater-scrubber-chapter-mark')!).backgroundColor,
        barColor: getComputedStyle(root.host).getPropertyValue('--appearance-surface') || getComputedStyle(root.querySelector('.theater-controls-wrapper')!, '::before').backgroundColor
      };
    });
    const expectEqualHeights = (m: Awaited<ReturnType<typeof measure>>, state: string) => {
      for (const segment of m.segments) {
        assert.ok(Math.abs(segment.height - m.track.height) < 0.5, `${state}: segment ${segment.height}px vs track ${m.track.height}px`);
        assert.ok(Math.abs(segment.top - m.track.top) < 0.5, `${state}: segment top ${segment.top} vs track ${m.track.top}`);
      }
    };
    if (name === 'Chromium' && process.env.SB_SHOT) await page.screenshot({ path: process.env.SB_SHOT, clip: { x: 170, y: 735, width: 450, height: 30 } });
    const rest = await measure();
    expectEqualHeights(rest, 'rest');
    assert.equal(await markers(page).first().evaluate(el => getComputedStyle(el).borderTopWidth), '0px', 'border must not add visible height');
    // Fixture boundaries: 2-8%, 10-35%, 60% point. Distinct positions only.
    assert.deepEqual(rest.ticks.map(left => Number.parseFloat(left)).map(value => Math.round(value * 100) / 100), [2, 8, 10, 35, 60]);
    await page.locator('.theater-scrubber-container').hover();
    await page.waitForFunction(() => {
      const track = document.querySelector('#theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-scrubber-track')!;
      return track.getBoundingClientRect().height === 6;
    });
    expectEqualHeights(await measure(), 'hover');
    await browser.close();
  });
}
