import { testEngines } from '../test-utils/test-engines';
import { bundleModules, playerStylesheets } from '../test-utils/player-boot';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { Page } from 'playwright';
import { clockLabels } from './time-readout';

const UI_CSS = playerStylesheets().ui;
const BUNDLE = bundleModules(["export * from './ui/time-readout';"], 'TimeReadout');

/** The player bar inside a shadow root carrying the player UI sheet, as the extension mounts it. */
async function mountBar(page: Page): Promise<void> {
  await page.setContent('<div id="theater-everywhere-ui"></div>');
  await page.addScriptTag({ content: `${BUNDLE}\nwindow.TimeReadout = TimeReadout;` });
  await page.evaluate(`(css => {
    const shadow = document.querySelector('#theater-everywhere-ui').attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    const bar = document.createElement('div');
    bar.innerHTML = \`<div class="theater-controls-wrapper visible">
      <div class="theater-controls-row">
        <div class="theater-controls-left">
          <button class="theater-control-btn" type="button"></button>
          <span id="elapsed" class="theater-time-display theater-time-elapsed" dir="ltr"></span>
        </div>
        <div id="scrubber" class="theater-scrubber-container"><div class="theater-scrubber-track"></div></div>
        <div class="theater-controls-right">
          <button id="end" class="theater-time-display theater-time-end" type="button" dir="ltr"></button>
          <button class="theater-control-btn" type="button"></button>
        </div>
      </div>
    </div>\`;
    shadow.append(style, bar.firstElementChild);
    window.paint = (elapsed, edge, animate) => {
      window.TimeReadout.renderTimeReadout(shadow.querySelector('#elapsed'), elapsed, animate);
      window.TimeReadout.renderTimeReadout(shadow.querySelector('#end'), edge, animate);
    };
    window.box = (id) => {
      const rect = shadow.querySelector(id).getBoundingClientRect();
      return { x: Math.round(rect.x * 100) / 100, w: Math.round(rect.width * 100) / 100 };
    };
  })(${JSON.stringify(UI_CSS)})`);
}

describe('split time readout', () => {
  it('keeps the scrubber still while digits and the duration toggle change', async () => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) return;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 400 } });
      await mountBar(page);

      const end = 2 * 3600 + 15 * 60;
      const frames = [
        clockLabels(0, end, false),
        clockLabels(59, end, false),
        clockLabels(3600, end, false),
        clockLabels(end - 1, end, false),
        clockLabels(end - 1, end, true)
      ];
      const measure = async (labels: { elapsed: string; edge: string }) => {
        await page.evaluate(`window.paint(${JSON.stringify(labels.elapsed)}, ${JSON.stringify(labels.edge)}, false)`);
        return await page.evaluate(`(() => {
          const scrubber = window.box('#scrubber');
          const elapsed = window.box('#elapsed');
          const edge = window.box('#end');
          return {
            scrubberX: scrubber.x,
            scrubberW: scrubber.w,
            elapsedRight: elapsed.x + elapsed.w,
            edgeX: edge.x,
            order: elapsed.x < scrubber.x && scrubber.x + scrubber.w <= edge.x + 0.5
          };
        })()`) as {
          scrubberX: number;
          scrubberW: number;
          elapsedRight: number;
          edgeX: number;
          order: boolean;
        };
      };

      const first = await measure(frames[0]);
      assert.equal(first.order, true, JSON.stringify(first));
      for (const frame of frames.slice(1)) {
        const next = await measure(frame);
        assert.ok(Math.abs(next.scrubberX - first.scrubberX) < 0.6, JSON.stringify({ first, next, frame }));
        assert.ok(Math.abs(next.scrubberW - first.scrubberW) < 0.6, JSON.stringify({ first, next, frame }));
        assert.ok(Math.abs(next.elapsedRight - first.elapsedRight) < 0.6, JSON.stringify({ first, next, frame }));
        assert.ok(Math.abs(next.edgeX - first.edgeX) < 0.6, JSON.stringify({ first, next, frame }));
      }
    } finally {
      await browser.close();
    }
  });

  it('rolls a changed digit in the clock color and settles sharp', async () => {
    const { chromium } = await import('playwright');
    if (!existsSync(chromium.executablePath())) return;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 900, height: 400 } });
      await mountBar(page);
      await page.evaluate(`window.paint('1:23:45', '-0:36:15', false)`);
      const steadyScrubber = await page.evaluate(`window.box('#scrubber')`);
      await page.evaluate(`window.paint('1:23:46', '-0:36:14', true)`);

      type Glyph = { text: string; color: string; opacity: string; textShadow: string; filter: string; y: number };
      const sample = async (time: number) => await page.evaluate(`(() => {
        const shadow = document.querySelector('#theater-everywhere-ui').shadowRoot;
        for (const animation of shadow.getAnimations()) {
          animation.pause();
          animation.currentTime = ${time};
        }
        const glyphs = (id) => [...shadow.querySelectorAll(id + ' .theater-time-slot:last-child .theater-time-glyph')].map((glyph) => {
          const style = getComputedStyle(glyph);
          return {
            text: glyph.textContent,
            color: style.color,
            opacity: style.opacity,
            textShadow: style.textShadow,
            filter: style.filter,
            y: new DOMMatrixReadOnly(style.transform).m42
          };
        });
        return { elapsed: glyphs('#elapsed'), edge: glyphs('#end'), scrubber: window.box('#scrubber') };
      })()`) as { elapsed: Glyph[]; edge: Glyph[]; scrubber: { x: number; w: number } };
      const blur = (glyph: Glyph | undefined) => Number(glyph?.filter.match(/blur\(([\d.]+)px\)/)?.[1] ?? 0);

      for (const time of [0, 160, 320]) {
        const frame = await sample(time);
        const detail = JSON.stringify({ time, frame });
        assert.deepEqual(frame.scrubber, steadyScrubber, detail);
        for (const glyph of [...frame.elapsed, ...frame.edge]) {
          assert.equal(glyph.color, 'rgb(161, 161, 170)', detail);
          assert.equal(glyph.opacity, '1', detail);
          assert.equal(glyph.textShadow, 'none', detail);
        }
        const entering = frame.elapsed.find((glyph) => glyph.text === '6');
        if (time === 0) {
          assert.ok((entering?.y ?? 0) > 0, `elapsed counts up from below: ${detail}`);
          assert.ok((frame.edge.find((glyph) => glyph.text === '4')?.y ?? 0) < 0, `remaining counts down from above: ${detail}`);
        }
        if (time === 160) assert.ok(blur(entering) > 0.2 && blur(entering) < 1.2, `soft but readable: ${detail}`);
        if (time === 320) assert.equal(blur(entering), 0, detail);
      }

      await page.evaluate(`(() => {
        for (const animation of document.querySelector('#theater-everywhere-ui').shadowRoot.getAnimations()) animation.play();
        window.paint('1:23:47', '-0:36:13', true);
      })()`);
      const midway = await page.evaluate(`document.querySelector('#theater-everywhere-ui').shadowRoot
        .querySelectorAll('#elapsed .theater-time-slot:last-child .theater-time-glyph').length`);
      assert.equal(midway, 2, 'a fresh tick replaces the glyph still leaving');
      await page.waitForFunction(`!document.querySelector('#theater-everywhere-ui').shadowRoot
        .querySelector('.is-rolling, .is-entering, .is-leaving')`);
      const settled = await page.evaluate(`[...document.querySelector('#theater-everywhere-ui').shadowRoot
        .querySelectorAll('.theater-time-glyph')].map((glyph) => glyph.textContent).join('')`);
      assert.equal(settled, '1:23:47-0:36:13');
    } finally {
      await browser.close();
    }
  });
});

for (const engineName of testEngines()) {
  describe(`${engineName}: digit roll stagger and overshoot`, () => {
    type Probe = { text: string; slot: number; delay: number; y: number; leaving: boolean };

    async function withBar(run: (page: Page) => Promise<void>): Promise<void> {
      const playwright = await import('playwright');
      const engine = playwright[engineName];
      if (!existsSync(engine.executablePath())) return;
      const browser = await engine.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 900, height: 400 } });
        await mountBar(page);
        await run(page);
      } finally {
        await browser.close();
      }
    }

    /** Freezes every animation `offset` ms after its own delay and reads the glyph transforms. */
    const sampleAt = (page: Page, offset: number) => page.evaluate(`(() => {
      const shadow = document.querySelector('#theater-everywhere-ui').shadowRoot;
      for (const animation of shadow.getAnimations()) {
        animation.pause();
        animation.currentTime = animation.effect.getTiming().delay + ${offset};
      }
      return [...shadow.querySelectorAll('#elapsed .theater-time-glyph')].map((glyph) => {
        const slot = glyph.closest('.theater-time-slot');
        const animations = glyph.getAnimations();
        return {
          text: glyph.textContent,
          slot: [...slot.parentElement.children].indexOf(slot),
          delay: animations.length ? animations[0].effect.getTiming().delay : -1,
          y: new DOMMatrixReadOnly(getComputedStyle(glyph).transform).m42,
          leaving: glyph.classList.contains('is-leaving')
        };
      });
    })()`) as Promise<Probe[]>;

    it('starts the left digit before the right one', async () => {
      await withBar(async (page) => {
        await page.evaluate(`window.paint('0:39', '-0:21', false)`);
        await page.evaluate(`window.paint('0:40', '-0:20', true)`);
        const probes = await sampleAt(page, 0);
        const entering = probes.filter((probe) => !probe.leaving);
        const tens = entering.find((probe) => probe.text === '4');
        const ones = entering.find((probe) => probe.text === '0' && probe.slot === 3);
        assert.ok(tens && ones, JSON.stringify(probes));
        assert.equal(tens.delay, 0);
        assert.ok(ones.delay > tens.delay && ones.delay <= 60, JSON.stringify(probes));
        // The old right digit holds its place until its own turn.
        assert.ok(probes.some((probe) => probe.leaving && probe.slot === 3 && probe.text === '9' && probe.y === 0), JSON.stringify(probes));
      });
    });

    it('overshoots past the rest line in the travel direction and ends at rest', async () => {
      await withBar(async (page) => {
        await page.evaluate(`window.paint('0:41', '-0:21', false)`);
        await page.evaluate(`window.paint('0:42', '-0:21', true)`);
        const climbing = (await sampleAt(page, 320 * 0.65)).find((probe) => probe.text === '2' && !probe.leaving);
        assert.ok(climbing && climbing.y < -0.2 && climbing.y > -2, `climbing digit passes above: ${JSON.stringify(climbing)}`);
        const climbed = (await sampleAt(page, 320)).find((probe) => probe.text === '2' && !probe.leaving);
        assert.equal(climbed?.y, 0);

        await page.evaluate(`window.paint('0:42', '-0:21', false)`);
        await page.evaluate(`window.paint('0:41', '-0:21', true)`);
        const falling = (await sampleAt(page, 320 * 0.65)).find((probe) => probe.text === '1' && !probe.leaving);
        assert.ok(falling && falling.y > 0.2 && falling.y < 2, `falling digit passes below: ${JSON.stringify(falling)}`);
        const fell = (await sampleAt(page, 320)).find((probe) => probe.text === '1' && !probe.leaving);
        assert.equal(fell?.y, 0);
      });
    });

    it('rolls a carry the way the clock moves', async () => {
      await withBar(async (page) => {
        await page.evaluate(`window.paint('0:59', '-0:21', false)`);
        await page.evaluate(`window.paint('1:00', '-0:21', true)`);
        const probes = await sampleAt(page, 320 * 0.65);
        for (const probe of probes.filter((candidate) => !candidate.leaving && candidate.delay >= 0)) {
          assert.ok(probe.y < 0, `every carried digit climbs: ${JSON.stringify(probes)}`);
        }
      });
    });

    it('reduced motion swaps digits with no animation or delay', async () => {
      await withBar(async (page) => {
        await page.evaluate(`(() => {
          document.documentElement.dataset.motion = 'reduced';
          document.querySelector('#theater-everywhere-ui').setAttribute('data-motion', 'reduced');
        })()`);
        await page.evaluate(`window.paint('0:39', '-0:21', false)`);
        await page.evaluate(`window.paint('0:40', '-0:20', true)`);
        const state = await page.evaluate(`(() => {
          const shadow = document.querySelector('#theater-everywhere-ui').shadowRoot;
          return {
            animations: shadow.getAnimations().length,
            rolling: shadow.querySelectorAll('.is-rolling, .is-entering, .is-leaving').length,
            delays: [...shadow.querySelectorAll('#elapsed .theater-time-slot')].map((slot) => slot.style.getPropertyValue('--theater-time-roll-delay')),
            text: shadow.querySelector('#elapsed').textContent
          };
        })()`) as { animations: number; rolling: number; delays: string[]; text: string };
        assert.deepEqual(state, { animations: 0, rolling: 0, delays: ['', '', '', ''], text: '0:40' });
      });
    });

    it('leaves no stale transform after rapid successive updates', async () => {
      await withBar(async (page) => {
        await page.evaluate(`window.paint('0:30', '-0:21', false)`);
        await page.evaluate(`(() => {
          const root = document.querySelector('#theater-everywhere-ui').shadowRoot;
          for (let second = 31; second <= 45; second += 1) {
            window.paint('0:' + second, '-0:21', true);
            // Interrupt native rolls at a controlled point, independent of runner speed.
            for (const animation of root.getAnimations()) {
              animation.pause();
              animation.currentTime = Number(animation.currentTime) + 70;
            }
          }
          for (const animation of root.getAnimations()) animation.play();
        })()`);
        await page.waitForFunction(`!document.querySelector('#theater-everywhere-ui').shadowRoot
          .querySelector('.is-rolling, .is-entering, .is-leaving')`);
        const settled = await page.evaluate(`(() => {
          const shadow = document.querySelector('#theater-everywhere-ui').shadowRoot;
          return {
            glyphs: [...shadow.querySelectorAll('#elapsed .theater-time-glyph')].map((glyph) => glyph.textContent + getComputedStyle(glyph).transform),
            animations: shadow.getAnimations().length,
            delays: [...shadow.querySelectorAll('#elapsed .theater-time-slot')].map((slot) => slot.style.getPropertyValue('--theater-time-roll-delay'))
          };
        })()`) as { glyphs: string[]; animations: number; delays: string[] };
        assert.deepEqual(settled, { glyphs: ['0none', ':none', '4none', '5none'], animations: 0, delays: ['', '', '', ''] });
      });
    });
  });
}
