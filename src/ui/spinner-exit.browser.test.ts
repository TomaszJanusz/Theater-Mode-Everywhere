import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { it } from 'node:test';

import { chromium, firefox, type Page } from 'playwright';

import { installChromeStub } from '../test-utils/chrome-stub';
import { bundleModules, playerStylesheets } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';

const browsers = Object.fromEntries(testEngines().map(engine => [engine, sharedTestBrowser({ chromium, firefox }[engine])]));

declare global {
  interface Window {
    SpinnerTest: {
      showAutoTheaterNotice(paint: (element: HTMLElement) => void, cancel: () => void, remainingMs: () => number, ringTurn?: 'uniform' | 'per-digit'): () => void;
      setPlayerUiCss(css: string): void;
    };
    noticeHide: () => void;
  }
}

const bundle = bundleModules([
  "export { exitSpinner } from './ui/spinner-exit';",
  "export { showAutoTheaterNotice } from './ui/auto-theater-notice';",
  "export { createHud } from './ui/hud';",
  "export { bootstrapPlayerRuntime } from './ui/player-runtime';",
  "export { setPlayerUiCss } from './ui/root';"
], 'SpinnerTest');
const css = playerStylesheets().ui;

async function setup(page: Page) {
  await page.addInitScript('window.__name = target => target;');
  await page.goto('about:blank');
  await page.addScriptTag({ content: bundle });
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
  await page.evaluate(() => {
    // Native WAAPI rendering, with its timeline driven explicitly by the test clock.
    // Playwright's clock controls alarms, but does not advance the document animation timeline.
    const native = HTMLElement.prototype.animate;
    Object.assign(window, { exits: [] });
    HTMLElement.prototype.animate = function (frames, options) {
      const animation = native.call(this, frames, options);
      // The countdown's per-second ring turn is not an exit.
      if (Array.isArray(frames) && frames.some(frame => 'rotate' in frame)) return animation;
      animation.pause();
      const duration = Number(animation.effect!.getTiming().duration);
      const record = { animation, element: this, started: performance.now(), duration };
      (window as unknown as { exits: unknown[] }).exits.push(record);
      const alarm = setTimeout(() => {
        animation.currentTime = duration;
        animation.dispatchEvent(new Event('finish'));
      }, duration);
      const cancel = animation.cancel.bind(animation);
      animation.cancel = () => { clearTimeout(alarm); cancel(); };
      return animation;
    };
  });
  await page.evaluate(`SpinnerTest.setPlayerUiCss(${JSON.stringify(css)});
    document.body.style.cssText = 'background:#14202e;color:white';
    window.session = { element: document.body, currentEpoch: 1 };
    window.hud = SpinnerTest.createHud({ session,
      queryPlayerUi: selector => document.getElementById('theater-everywhere-ui')?.shadowRoot?.querySelector(selector),
      mountPlayerUi: overlay => { let root = document.getElementById('theater-everywhere-ui')?.shadowRoot;
        if (!root) { const host = document.createElement('div'); host.id = 'theater-everywhere-ui'; host.dataset.motion = 'normal';
          document.body.append(host); root = host.attachShadow({mode:'open'}); const style = document.createElement('style');
          style.textContent = ${JSON.stringify(css)}; root.append(style); } root.append(overlay); },
      t: key => key,
      paintOverlay() {}
    });`);
}

async function capture(page: Page, name: string, elapsed: number) {
  await page.evaluate(elapsed => {
    const records = (window as unknown as { exits: { animation: Animation }[] }).exits;
    for (const { animation } of records) if (animation.playState !== 'idle') animation.currentTime = elapsed;
  }, elapsed);
  if (process.env.SPINNER_SCREENSHOT_DIR) {
    mkdirSync(process.env.SPINNER_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: `${process.env.SPINNER_SCREENSHOT_DIR}/${name}.png` });
  }
}

async function assertUnscaled(page: Page, selector: string, translated = false) {
  const styles = await page.locator(selector).evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element);
    return { opacity: style.opacity, transform: style.transform, scale: style.scale };
  }));
  assert.ok(styles.length > 0);
  for (const style of styles) {
    assert.equal(style.opacity, '1');
    assert.ok(style.transform === 'none' || style.transform === 'matrix(1, 0, 0, 1, 0, 0)' || translated && /^matrix\(1, 0, 0, 1, [^,]+, [^)]+\)$/.test(style.transform));
    assert.ok(style.scale === 'none' || style.scale === '1');
  }
}

async function assertShrinking(page: Page, selector: string) {
  const style = await page.locator(selector).evaluate(element => {
    const style = getComputedStyle(element);
    return { scale: Number(style.scale), opacity: Number(style.opacity) };
  });
  assert.ok(style.scale > 0 && style.scale < 1 && style.opacity > 0 && style.opacity < 1);
}

for (const engine of testEngines()) {
  const shared = browsers[engine];
  for (const motion of ['normal', 'reduced', 'system'] as const) {
    it(`${engine}: centred confirmations reset their extra two seconds and clean up (${motion})`, { timeout: 40_000 }, async t => {
      const page = await (await shared.newContext(t)).newPage();
      await setup(page);
      if (motion === 'system') await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(`hud.triggerVolumeIndicator(0.5, false, 'up');
        document.getElementById('theater-everywhere-ui').dataset.motion = '${motion === 'reduced' ? 'reduced' : 'normal'}';
        window.originalHud = document.getElementById('theater-everywhere-ui').shadowRoot.querySelector('.theater-everywhere-volume-overlay');`);
      const plate = page.locator('.theater-everywhere-volume-overlay');
      const triggers = [
        "hud.triggerVolumeIndicator(0.6, false, 'up')",
        "hud.triggerStatusIndicator('Bass: More', '')",
        "hud.triggerPlaybackIndicator('play')",
        "hud.triggerPlaybackIndicator('play')"
      ];
      for (const [index, trigger] of triggers.entries()) {
        await page.clock.runFor(index === 0 ? 800 : 599);
        assert.equal(await plate.evaluate(e => e.classList.contains('fade-out')), false, 'old hide deadline stays visible');
        await page.clock.runFor(1999);
        assert.equal(await plate.evaluate(e => e.classList.contains('fade-out')), false, 'visible for the extra two seconds');
        await page.evaluate(trigger);
        await page.clock.runFor(201);
        assert.equal(await plate.evaluate(e => e === (window as unknown as { originalHud: Element }).originalHud), true, 'retrigger keeps the same plate past stale hide/removal deadlines');
        assert.equal(await plate.evaluate(e => e.classList.contains('fade-out')), false);
        assert.equal(await plate.locator('.volume-hud-content').count(), 1);
      }
      await page.clock.runFor(2599);
      assert.equal(await plate.evaluate(e => e.classList.contains('fade-out')), true);
      await page.evaluate("hud.triggerStatusIndicator('Replacement', '')");
      await page.clock.runFor(200);
      assert.equal(await plate.evaluate(e => e.classList.contains('fade-out')), false, 'retrigger cancels an in-flight removal');
      await page.clock.runFor(2600);
      assert.equal(await plate.evaluate(e => e.classList.contains('fade-out')), true);
      await page.clock.runFor(199);
      assert.equal(await plate.count(), 1);
      await page.clock.runFor(1);
      assert.equal(await plate.count(), 0, 'existing 200 ms fade removal is preserved');
      await page.evaluate("hud.triggerPlaybackIndicator('pause'); hud.removeCenteredHud(); hud.removeCenteredHud(); hud.triggerVolumeIndicator(0.5, false, 'up')");
      await page.clock.runFor(100);
      await page.evaluate('session.currentEpoch++; session.element = document.createElement("video")');
      await page.clock.runFor(2900);
      assert.equal(await plate.evaluate(e => e.classList.contains('fade-out')), false, 'old session cannot mutate a newer session');
      await page.evaluate('hud.removeCenteredHud()');
      assert.equal(await plate.count(), 0);
    });
  }

  it(`${engine}: deadline exit uses the intent clock, runs during the final 0 stage, and cleans up`, { timeout: 40_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await setup(page);
    await page.evaluate(`const deadline = performance.now() + 3000;
      window.hide = SpinnerTest.showAutoTheaterNotice(() => {}, () => {}, () => deadline - performance.now());`);
    const visual = page.locator('.theater-auto-notice-visual');
    const spinner = page.locator('.theater-auto-notice .caption-hud-spinner');
    await page.clock.runFor(1500);
    await capture(page, `${engine}-deadline-minus-1500`, 0);
    await page.clock.runFor(499);
    assert.equal(await page.evaluate('exits.length'), 0);
    await capture(page, `${engine}-deadline-before`, 0);
    await page.clock.runFor(1);
    assert.equal(await page.evaluate('exits.length'), 1);
    assert.equal(await page.evaluate('exits[0].duration'), 500);
    assert.equal(await visual.locator('.theater-time-glyph:not(.is-leaving)').innerText(), '0', 'the exit starts as the digit reaches 0');
    await capture(page, `${engine}-deadline-start`, 0);
    assert.equal(await page.evaluate('exits[0].element.className'), 'caption-hud-spinner');
    // The 1→0 roll is still running here, so the glyph is checked once it settles.
    await assertUnscaled(page, '.theater-auto-notice-visual, .theater-auto-notice-count');
    await page.clock.runFor(250);
    await capture(page, `${engine}-deadline-middle`, 250);
    await assertShrinking(page, '.theater-auto-notice .caption-hud-spinner');
    await assertUnscaled(page, '.theater-auto-notice-visual, .theater-auto-notice-count');
    assert.equal(await visual.locator('.theater-time-glyph:not(.is-leaving)').innerText(), '0');
    await page.clock.runFor(249);
    assert.equal(await spinner.count(), 1);
    await page.clock.runFor(1);
    assert.equal(await spinner.count(), 0, 'removed exactly 500 ms before entry');
    assert.equal(await page.locator('.theater-auto-notice').count(), 1, 'notice timing stays unchanged');
    await capture(page, `${engine}-deadline-end`, 500);
    assert.equal(await visual.locator('.theater-time-glyph:not(.is-leaving)').innerText(), '0', 'the digit stays 0 as the ring clears');
    await page.clock.runFor(250);
    await capture(page, `${engine}-deadline-minus-250`, 500);
    assert.equal(await visual.locator('.theater-time-glyph:not(.is-leaving)').innerText(), '0', 'the final stretch shows 0');
    await assertUnscaled(page, '.theater-auto-notice-visual, .theater-auto-notice-count');
    await page.evaluate('hide(); hide()');
    await page.evaluate(`window.hide = SpinnerTest.showAutoTheaterNotice(() => {}, () => {}, () => 3000); hide(); hide();`);
    await page.clock.runFor(5000);
    assert.equal(await page.evaluate('exits.length'), 1, 'dismissal cancels the deadline alarm');

    // A callback that wakes early re-reads the source clock rather than guessing a deadline.
    await page.evaluate(`window.remaining = 1500; window.ring = document.createElement('div'); document.body.append(ring);
      window.stop = SpinnerTest.exitSpinner(ring, {mode:'deadline', remainingMs: () => remaining});`);
    await page.clock.runFor(500);
    assert.equal(await page.evaluate('exits.length'), 1, 'the source clock still has 1500 ms remaining');
    await page.evaluate('remaining = 1000');
    await page.clock.runFor(500);
    assert.equal(await page.evaluate('exits.length'), 2);
    await page.evaluate('stop(); stop()');
    await page.clock.runFor(500);
    assert.equal(await page.evaluate('ring.isConnected'), true, 'cancelled completion cannot remove its element');
    await page.evaluate(`window.stop = SpinnerTest.exitSpinner(ring, {mode:'deadline', remainingMs: () => 750});`);
    assert.equal(await page.evaluate('exits[2].animation.currentTime'), 250, 'a late start catches up to the real clock');
    await page.evaluate('stop(); ring.remove()');
  });

  it(`${engine}: passive caption exit preserves nodes, reveals the track and cancels stale work`, { timeout: 40_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await setup(page);
    await page.evaluate(`hud.triggerCaptionHud({kind:'loading',title:'Loading subtitles…'})`);
    await page.clock.runFor(400);
    await page.evaluate(`window.original = document.getElementById('theater-everywhere-ui').shadowRoot.querySelector('.caption-hud-spinner');
      window.originalSpin = original.getAnimations()[0];
      window.title = original.closest('.theater-everywhere-caption-hud').querySelector('.volume-hud-text');
      hud.triggerCaptionHud({kind:'status',title:'Subtitles on',detail:'English',duration:4000});`);
    assert.equal(await page.evaluate(`original === document.getElementById('theater-everywhere-ui').shadowRoot.querySelector('.caption-hud-spinner')`), true);
    assert.equal(await page.evaluate(`title === original.closest('.theater-everywhere-caption-hud').querySelector('.volume-hud-text') && title.textContent === 'Subtitles on'`), true);
    assert.equal(await page.evaluate('original.getAnimations().includes(originalSpin)'), true, 'the rotating CSS animation also survives the update');
    const detail = page.locator('.volume-hud-detail');
    const slot = page.locator('.caption-hud-spinner-slot');
    const before = await slot.boundingBox();
    await capture(page, `${engine}-caption-start`, 0);
    assert.equal(await detail.evaluate(e => getComputedStyle(e).opacity), '0');
    await page.clock.runFor(250);
    await capture(page, `${engine}-caption-middle`, 250);
    await assertUnscaled(page, '.caption-hud-spinner-slot, .volume-hud-text, .volume-hud-copy');
    assert.equal(await page.evaluate("exits.filter(record => record.element.classList.contains('caption-hud-spinner')).length"), 1);
    const shrinking = await page.locator('.caption-hud-spinner').evaluate(e => {
      const style = getComputedStyle(e);
      return { scale: Number(style.scale), opacity: Number(style.opacity) };
    });
    assert.ok(shrinking.scale > 0 && shrinking.scale < 1 && shrinking.opacity > 0 && shrinking.opacity < 1,
      'the exit composes with the existing CSS rotation');
    await page.clock.runFor(150);
    await capture(page, `${engine}-caption-handoff`, 400);
    await page.clock.runFor(99);
    await capture(page, `${engine}-caption-reveal`, 499);
    assert.equal(await page.locator('.caption-hud-spinner').count(), 1);
    await page.clock.runFor(1);
    assert.equal(await page.locator('.caption-hud-spinner').count(), 0);
    assert.equal(await detail.evaluate(e => getComputedStyle(e).opacity), '1');
    const after = await slot.boundingBox();
    assert.deepEqual({ width: after!.width, height: after!.height, y: after!.y }, { width: before!.width, height: before!.height, y: before!.y }, 'spinner slot does not collapse');
    await capture(page, `${engine}-caption-end`, 500);

    // Cancel while exiting, then publish a replacement; old completions must not remove it.
    await page.evaluate(`hud.triggerCaptionHud({kind:'loading',title:'Loading'})`);
    await page.clock.runFor(400);
    await page.evaluate(`hud.triggerCaptionHud({kind:'status',title:'Old',detail:'English'});
      window.oldFinish = exits.filter(record => record.element.classList.contains('caption-hud-spinner')).at(-1).animation.onfinish;
      hud.removeCaptionHud(); hud.removeCaptionHud(); oldFinish(new Event('finish'));
      hud.triggerCaptionHud({kind:'loading',title:'Replacement'})`);
    await page.clock.runFor(500);
    assert.equal(await page.locator('.caption-hud-spinner').count(), 1);
    assert.equal(await page.locator('.volume-hud-text').innerText(), 'Replacement');
    await page.evaluate(`hud.triggerCaptionHud({kind:'status',title:'Stale',detail:'English'}); session.currentEpoch++;`);
    await page.clock.runFor(500);
    assert.equal(await page.locator('.caption-hud-spinner').count(), 1, 'stale completion cannot mutate the old session');
    await page.evaluate('hud.removeCaptionHud()');
  });


  it(`${engine}: buffering exits for 500 ms, restarts cleanly and retires on theater exit`, { timeout: 40_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await setup(page);
    await page.evaluate(`document.body.innerHTML = '<video muted style="width:960px;height:540px"></video>';
      const video = document.querySelector('video');
      Object.defineProperties(video, { readyState: { configurable:true, value:4 }, duration: { configurable:true, value:60 } });
      `);
    await installChromeStub(page, { sync: { keepControlsVisible: true } });
    await page.evaluate('SpinnerTest.bootstrapPlayerRuntime()');
    await page.keyboard.press('t');
    await page.locator('.theater-controls-wrapper').waitFor();
    const spinner = page.locator('.theater-loading-spinner');
    const event = (name: string) => page.locator('video').dispatchEvent(name);
    await page.keyboard.press('ArrowUp');
    const confirmation = page.locator('.theater-everywhere-volume-overlay');
    await event('waiting');
    await page.clock.runFor(1000);
    assert.equal(await spinner.count(), 1);
    await page.locator('.theater-loading-indicator').evaluate(e => { for (const animation of e.getAnimations()) animation.finish(); });
    // The plate is a circle in the HUD family, centred over the picture with the ring centred inside.
    const plate = page.locator('.theater-loading-indicator');
    const geometry = await plate.evaluate(plate => {
      const box = plate.getBoundingClientRect();
      const ring = plate.querySelector('.theater-loading-spinner')!.getBoundingClientRect();
      const picture = document.querySelector('video')!.getBoundingClientRect();
      const style = getComputedStyle(plate);
      return {
        width: box.width, height: box.height, radius: style.borderRadius, plate: plate.classList.contains('theater-hud-plate'),
        offset: [box.left + box.width / 2 - ring.left - ring.width / 2, box.top + box.height / 2 - ring.top - ring.height / 2],
        center: [box.left + box.width / 2 - (picture.left + picture.width / 2), box.top + box.height / 2 - (picture.top + picture.height / 2)],
        background: style.backgroundColor, ring: (plate.querySelector('.theater-loading-spinner') as HTMLElement).offsetWidth
      };
    });
    assert.equal(geometry.width, geometry.height, 'round plate');
    assert.ok(geometry.width > geometry.ring + 16, 'padding around the ring');
    assert.equal(geometry.radius, '50%');
    assert.equal(geometry.plate, true);
    assert.notEqual(geometry.background, 'rgba(0, 0, 0, 0)');
    assert.ok(geometry.offset.every(value => Math.abs(value) < 0.5), 'ring is centred in the plate');
    assert.ok(geometry.center.every(value => Math.abs(value) < 1), 'plate is centred on the picture');
    await event('canplay');
    const centerOf = () => plate.evaluate(e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const centerBefore = await centerOf();
    await capture(page, `${engine}-buffer-start`, 0);
    assert.equal(await page.locator('.theater-loading-indicator.exiting').count(), 1);
    await page.clock.runFor(250);
    await capture(page, `${engine}-buffer-middle`, 250);
    // One motion: the plate carries the only exit animation and the ring zooms inside it.
    await assertShrinking(page, '.theater-loading-indicator');
    const centerDuring = await centerOf();
    assert.ok(centerDuring.every((value, i) => Math.abs(value - centerBefore[i]) < 0.5), 'the plate zooms about its own centre');
    assert.equal(await spinner.evaluate(e => getComputedStyle(e).scale), 'none');
    assert.equal(await page.evaluate("exits.length === 1 && exits[0].element.classList.contains('theater-loading-indicator')"), true);
    const timing = await page.evaluate(`(() => { const t = exits[0].animation.effect.getTiming(); return [t.duration, t.easing, t.fill]; })()`);
    assert.deepEqual(timing, [500, 'cubic-bezier(0.4, 0, 0.2, 1)', 'both']);
    await page.clock.runFor(249);
    assert.equal(await spinner.count(), 1);
    await page.clock.runFor(1);
    assert.equal(await spinner.count(), 0);
    assert.equal(await plate.evaluate(e => getComputedStyle(e).opacity), '0', 'the empty plate leaves with the ring');
    await capture(page, `${engine}-buffer-end`, 500);
    assert.equal(await confirmation.evaluate(e => e.classList.contains('fade-out')), false, 'confirmation outlasts its former 800 ms delay while buffering still exits in 500 ms');
    await page.clock.runFor(1299);
    assert.equal(await confirmation.evaluate(e => e.classList.contains('fade-out')), false);
    await page.clock.runFor(1);
    assert.equal(await confirmation.evaluate(e => e.classList.contains('fade-out')), true, 'confirmation hides at 800 + 2000 ms');
    await page.clock.runFor(200);
    assert.equal(await confirmation.count(), 0);

    await event('waiting');
    await page.clock.runFor(1000);
    assert.equal(await spinner.count(), 1, 'a later stall creates a fresh ring');
    await event('canplay');
    await page.clock.runFor(100);
    // A replacement load while playing: the bare element is paused, so make it report playback.
    const setPaused = (paused: boolean) => page.evaluate(`Object.defineProperty(document.querySelector('video'), 'paused', { configurable: true, value: ${paused} })`);
    await setPaused(false);
    await event('emptied');
    await page.clock.runFor(400);
    assert.equal(await spinner.count(), 1, 'a replacement load cancels the old exit');
    assert.equal(await spinner.evaluate(e => getComputedStyle(e).scale), 'none');
    await page.evaluate(`document.getElementById('theater-everywhere-ui').dataset.motion = 'reduced'`);
    await event('canplay');
    assert.equal(await spinner.count(), 0, 'buffering also disappears instantly with reduced motion');
    assert.equal(await page.locator('.theater-loading-indicator.exiting').count(), 0);
    await setPaused(true);
    await event('emptied');
    assert.equal(await spinner.count(), 0, 'a paused reset shows no spinner');
    await page.evaluate(`document.getElementById('theater-everywhere-ui').dataset.motion = 'normal'`);
    await event('waiting');
    await page.clock.runFor(1000);
    await event('canplay');
    await page.locator('.close-btn').dispatchEvent('click');
    await page.clock.runFor(1000);
    assert.equal(await page.locator('.theater-loading-indicator').count(), 0);
    assert.equal(await page.evaluate('exits.every(record => record.animation.playState === "idle")'), true, 'all owned effects are cancelled');
  });

  it(`${engine}: caption notice width morphs between states without jumping and cleans up`, { timeout: 40_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await setup(page);
    const hudBox = () => page.locator('.theater-everywhere-caption-hud').evaluate(e => {
      const box = e.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width };
    });
    const morphs = () => page.evaluate(`exits.filter(record => record.element.classList.contains('theater-everywhere-caption-hud')).length`);
    await page.evaluate(`hud.triggerCaptionHud({kind:'loading',title:'Loading subtitles…'})`);
    await page.clock.runFor(400);
    const loading = await hudBox();
    await page.evaluate(`hud.triggerCaptionHud({kind:'status',title:'Subtitles on',detail:'English (United Kingdom)',duration:4000})`);
    assert.equal(await morphs(), 1);
    const timing = await page.evaluate<{ duration: number; from: string; to: string; easing: string }>(`(() => { const record = exits.find(r => r.element.classList.contains('theater-everywhere-caption-hud'));
      const frames = record.animation.effect.getKeyframes(); return { duration: record.duration, from: frames[0].width, to: frames[1].width,
        easing: record.animation.effect.getTiming().easing }; })()`);
    assert.equal(timing.duration, 225);
    assert.equal(timing.easing, 'ease');
    assert.ok(Math.abs(Number.parseFloat(timing.from) - loading.width) < 0.01, 'starts from the pre-update width: no jump');
    const target = Number.parseFloat(timing.to);
    assert.notEqual(Math.round(target), Math.round(loading.width));
    const start = await hudBox();
    assert.ok(Math.abs(start.width - loading.width) < 1, 'first frame keeps the old width');
    assert.ok(Math.abs(start.right - loading.right) < 0.5, 'right anchor holds');
    await capture(page, `${engine}-morph-start`, 0);
    await page.evaluate(`exits.find(r => r.element.classList.contains('theater-everywhere-caption-hud')).animation.currentTime = 112`);
    const middle = await hudBox();
    assert.ok(middle.width > Math.min(loading.width, target) && middle.width < Math.max(loading.width, target), 'width is between the states');
    assert.ok(Math.abs(middle.right - loading.right) < 0.5);
    await capture(page, `${engine}-morph-middle`, 112);
    await page.evaluate(`exits.find(r => r.element.classList.contains('theater-everywhere-caption-hud')).animation.currentTime = 225`);
    await capture(page, `${engine}-morph-end`, 225);
    await page.clock.runFor(225);
    assert.ok(Math.abs((await hudBox()).width - target) < 1, 'settles on the natural width');
    assert.equal(await page.evaluate(`getComputedStyle(document.getElementById('theater-everywhere-ui').shadowRoot.querySelector('.theater-everywhere-caption-hud')).width`), `${target}px`);

    // Same-width updates start nothing; a replacement or removal cancels the running morph.
    await page.evaluate(`hud.removeCaptionHud(); hud.triggerCaptionHud({kind:'loading',title:'Loading subtitles…'})`);
    await page.clock.runFor(400);
    await page.evaluate(`hud.triggerCaptionHud({kind:'status',title:'Subtitles on',detail:'English',duration:4000});
      window.record = exits.filter(r => r.element.classList.contains('theater-everywhere-caption-hud')).at(-1);`);
    assert.equal(await page.evaluate('record.animation.playState'), 'paused');
    await page.evaluate(`hud.removeCaptionHud(); hud.removeCaptionHud()`);
    assert.equal(await page.evaluate('record.animation.playState'), 'idle', 'removal cancels the morph');
    await page.evaluate(`hud.triggerCaptionHud({kind:'loading',title:'Loading subtitles…'})`);
    await page.clock.runFor(400);
    await page.evaluate(`hud.triggerCaptionHud({kind:'status',title:'Subtitles on',detail:'English',duration:4000});
      window.stale = exits.filter(r => r.element.classList.contains('theater-everywhere-caption-hud')).at(-1);
      hud.triggerCaptionHud({kind:'loading',title:'Replacement'})`);
    assert.equal(await page.evaluate('stale.animation.playState'), 'idle', 'replacement cancels the old morph');
    await page.evaluate('hud.removeCaptionHud()');

    // Reduce motion changes the width at once.
    await page.evaluate(`document.getElementById('theater-everywhere-ui').dataset.motion = 'reduced';
      hud.triggerCaptionHud({kind:'loading',title:'Loading subtitles…'})`);
    await page.clock.runFor(400);
    const before = await page.evaluate('exits.length');
    await page.evaluate(`hud.triggerCaptionHud({kind:'status',title:'Subtitles on',detail:'English (United Kingdom)',duration:4000})`);
    assert.equal(await page.evaluate('exits.length'), before, 'no animation under reduced motion');
    await page.evaluate('hud.removeCaptionHud()');
  });

  it(`${engine}: off then on reveals the track name and morphs the width; rapid toggles leave nothing stale`, { timeout: 40_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await setup(page);
    const live = (selector: string) => page.evaluate(`exits.filter(r => r.element.matches('${selector}') && r.element.isConnected && r.animation.playState !== 'idle').length`);
    const off = `hud.triggerCaptionHud({kind:'status',title:'Subtitles off',duration:4000})`;
    const on = `hud.triggerCaptionHud({kind:'status',title:'Subtitles on',detail:'English',duration:4000})`;
    await page.evaluate(off);
    assert.equal(await page.locator('.volume-hud-detail').count(), 0);
    await page.clock.runFor(300);
    await page.evaluate(`window.title = document.getElementById('theater-everywhere-ui').shadowRoot.querySelector('.volume-hud-text'); ${on}`);
    assert.equal(await page.evaluate(`title === document.getElementById('theater-everywhere-ui').shadowRoot.querySelector('.volume-hud-text')`), true, 'same notice updated in place');
    const detail = page.locator('.volume-hud-detail');
    assert.equal(await detail.innerText(), 'English');
    assert.equal(await page.evaluate(`exits.find(r => r.element.classList.contains('volume-hud-detail')).duration`), 500, 'same reveal as Loading to Loaded');
    assert.equal(await live('.theater-everywhere-caption-hud'), 1, 'width morph covers the content change');
    assert.equal(await detail.evaluate(e => getComputedStyle(e).opacity), '0');
    await capture(page, `${engine}-off-on-start`, 0);
    await capture(page, `${engine}-off-on-middle`, 300);
    assert.equal(await detail.evaluate(e => getComputedStyle(e).opacity !== '0' && getComputedStyle(e).opacity !== '1'), true);
    await capture(page, `${engine}-off-on-end`, 500);
    assert.equal(await detail.evaluate(e => getComputedStyle(e).opacity), '1');

    // Rapid on/off/on/off: only the latest content survives and no animation outlives its node.
    for (let i = 0; i < 2; i++) {
      await page.evaluate(off);
      await page.clock.runFor(40);
      await page.evaluate(on);
      await page.clock.runFor(40);
    }
    await page.evaluate(off);
    assert.equal(await page.locator('.volume-hud-detail').count(), 0, 'no leftover track name');
    assert.equal(await live('.volume-hud-detail'), 0, 'no reveal outlives its node');
    assert.equal(await live('.theater-everywhere-caption-hud'), 1, 'one morph at a time');
    assert.equal(await page.locator('.theater-everywhere-caption-hud').count(), 1);
    await page.clock.runFor(4300);
    assert.equal(await page.locator('.theater-everywhere-caption-hud').count(), 0);

    // A fresh "on" after the notice left still reveals the name; removal cancels it.
    await page.evaluate(on);
    assert.equal(await live('.volume-hud-detail'), 1);
    await page.evaluate('hud.removeCaptionHud(); hud.removeCaptionHud()');
    assert.equal(await page.evaluate("exits.filter(r => r.animation.playState !== 'idle' && r.animation.playState !== 'finished' && r.element.isConnected).length"), 0);
    assert.equal(await page.evaluate("exits.filter(r => r.element.classList.contains('volume-hud-detail')).at(-1).animation.playState"), 'idle');

    // Reduce motion: instant, nothing animates.
    await page.evaluate(`document.getElementById('theater-everywhere-ui').dataset.motion = 'reduced'`);
    const before = await page.evaluate('exits.length');
    await page.evaluate(off);
    await page.clock.runFor(100);
    await page.evaluate(on);
    assert.equal(await page.evaluate('exits.length'), before);
    assert.equal(await page.locator('.volume-hud-detail').evaluate(e => getComputedStyle(e).opacity), '1');
    await page.evaluate('hud.removeCaptionHud()');
  });

  it(`${engine}: notice text keeps its inline-end edge through the width morph in both directions`, { timeout: 40_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await setup(page);
    const off = `hud.triggerCaptionHud({kind:'status',title:'Subtitles off',duration:4000})`;
    const on = `hud.triggerCaptionHud({kind:'status',title:'Subtitles on',detail:'English (United Kingdom)',duration:4000})`;
    // Gap between the title's right edge and the notice's inner right edge (border and padding included).
    const gap = () => page.evaluate<number>(`(() => { const root = document.getElementById('theater-everywhere-ui').shadowRoot;
      const hud = root.querySelector('.theater-everywhere-caption-hud'); const title = root.querySelector('.volume-hud-text');
      return hud.getBoundingClientRect().right - title.getBoundingClientRect().right; })()`);
    const seek = (ms: number) => page.evaluate(`exits.filter(r => r.element.classList.contains('theater-everywhere-caption-hud')).at(-1).animation.currentTime = ${ms}`);
    for (const [from, to] of [[on, off], [off, on]]) {
      await page.evaluate(from);
      await page.clock.runFor(300);
      const settled = await gap();
      await page.evaluate(to);
      for (const ms of [0, 112, 225]) {
        await seek(ms);
        assert.ok(Math.abs((await gap()) - settled) < 0.5, `title stays on the inline end at ${ms} ms`);
      }
      await page.clock.runFor(500);
      assert.ok(Math.abs((await gap()) - settled) < 0.5, 'settled position matches');
      await page.evaluate('hud.removeCaptionHud()');
    }

    await page.evaluate(`document.getElementById('theater-everywhere-ui').dataset.motion = 'reduced'`);
    await page.evaluate(on);
    const reduced = await gap();
    await page.evaluate(off);
    assert.ok(Math.abs((await gap()) - reduced) < 0.5, 'reduced motion keeps the same alignment');
    await page.evaluate('hud.removeCaptionHud()');
  });

  it(`${engine}: reduced motion removes immediately, including a live preference change, and the final half second shows 0`, { timeout: 40_000 }, async t => {
    const page = await (await shared.newContext(t)).newPage();
    await setup(page);
    await page.evaluate(`hud.triggerCaptionHud({kind:'loading',title:'Loading'})`);
    await page.clock.runFor(400);
    await page.evaluate(`document.getElementById('theater-everywhere-ui').dataset.motion = 'reduced';
      hud.triggerCaptionHud({kind:'status',title:'Subtitles on',detail:'English'});`);
    assert.equal(await page.locator('.caption-hud-spinner').count(), 0);
    assert.equal(await page.evaluate('exits.length'), 0);
    await page.evaluate(`document.getElementById('theater-everywhere-ui').dataset.motion = 'normal';
      hud.triggerCaptionHud({kind:'loading',title:'Loading'})`);
    await page.clock.runFor(400);
    await page.evaluate(`hud.triggerCaptionHud({kind:'status',title:'Subtitles on',detail:'English'});
      document.getElementById('theater-everywhere-ui').dataset.motion = 'reduced';`);
    assert.equal(await page.locator('.caption-hud-spinner').count(), 0);
    assert.equal(await page.locator('.volume-hud-detail').evaluate(e => getComputedStyle(e).opacity), '1');
    await page.evaluate(`hud.removeCaptionHud(); document.documentElement.dataset.motion = 'reduced';
      const deadline = performance.now() + 3000;
      window.hide = SpinnerTest.showAutoTheaterNotice(() => {}, () => {}, () => deadline - performance.now());`);
    await page.clock.runFor(1999);
    assert.equal(await page.locator('.theater-auto-notice .caption-hud-spinner').count(), 1);
    await page.clock.runFor(1);
    assert.equal(await page.locator('.theater-auto-notice .caption-hud-spinner').count(), 0);
    await page.clock.runFor(750);
    assert.equal(await page.locator('.theater-auto-notice-count').innerText(), '0');
    await assertUnscaled(page, '.theater-auto-notice-visual, .theater-auto-notice-count, .theater-auto-notice-count .theater-time-glyph');
    await page.evaluate('hide()');
  });
}

/** Plate facts sampled on the page itself, so no frame between two samples can hide a transparent moment. */
const SAMPLER = `(${(() => {
  const samples: Array<Record<string, string | number>> = [];
  const overlay = () => document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector<HTMLElement>('.theater-auto-notice');
  const timer = setInterval(() => {
    const el = overlay();
    if (!el) return;
    const style = getComputedStyle(el);
    const alpha = /rgba?\(([^)]*)\)/.exec(style.backgroundColor)?.[1].split(/[ ,/]+/).filter(Boolean)[3];
    samples.push({
      t: Math.round(performance.now()), alpha: alpha === undefined ? 1 : Number(alpha), opacity: Number(style.opacity),
      width: el.getBoundingClientRect().width
    });
  }, 40);
  Object.assign(window, { plateSamples: samples });
  (window as unknown as { stopSamples: () => typeof samples }).stopSamples = () => { clearInterval(timer); return samples; };
}).toString()})()`;

for (const engine of testEngines()) {
  const shared = browsers[engine];
  for (const mode of ['normal', 'reduced transparency', 'high contrast', 'reduced motion'] as const) {
    it(`${engine}: the notice plate stays opaque through appear, countdown, ring exit and 0 (${mode})`, { timeout: 40_000 }, async t => {
      const page = await (await shared.newContext(t)).newPage();
      await page.addInitScript('window.__name = target => target;');
      await page.goto('about:blank');
      await page.setContent('<body style="margin:0;background:#fff;height:900px"></body>');
      await page.addScriptTag({ content: bundle });
      await page.evaluate(([css, how]) => {
        window.SpinnerTest.setPlayerUiCss(css!);
        const host = document.getElementById('theater-everywhere-ui') ?? (() => { window.SpinnerTest.showAutoTheaterNotice(() => {}, () => {}, () => 0)(); return document.getElementById('theater-everywhere-ui')!; })();
        if (how === 'reduced transparency') host.setAttribute('data-transparency', 'reduced');
        if (how === 'high contrast') host.setAttribute('data-contrast', 'high');
        if (how === 'reduced motion') host.setAttribute('data-motion', 'reduced');
      }, [css, mode]);
      await page.evaluate(SAMPLER);
      await page.evaluate(() => {
        const deadline = performance.now() + 2200;
        window.noticeHide = window.SpinnerTest.showAutoTheaterNotice(() => {}, () => {}, () => Math.max(0, deadline - performance.now()));
      });
      // Zero is the final displayed second; the ring's completed exit is the
      // positive signal that sampling covered both the countdown and its fade.
      await page.waitForFunction(() => {
        const notice = document.getElementById('theater-everywhere-ui')!.shadowRoot!.querySelector('.theater-auto-notice')!;
        return notice.querySelector('.theater-time-glyph:not(.is-leaving)')?.textContent === '0'
          && !notice.querySelector('.caption-hud-spinner')
          && (window as unknown as { plateSamples: unknown[] }).plateSamples.length > 40;
      });
      const samples = await page.evaluate(() => (window as unknown as { stopSamples(): Array<Record<string, number | string>> }).stopSamples());
      assert.ok(samples.length > 40, 'sampled across the whole countdown');
      for (const s of samples) {
        assert.equal(s.alpha, 1, `plate background opaque at ${JSON.stringify(s)}`);
        assert.equal(s.opacity, 1, `notice opaque at ${JSON.stringify(s)}`);
      }
      const widths = new Set(samples.map(s => s.width));
      assert.equal(widths.size, 1, 'the plate never morphs its width during the countdown');
    });
  }
}
