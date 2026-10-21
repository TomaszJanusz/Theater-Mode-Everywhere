import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Page } from 'playwright';

import { bootPlayer, enterTheater } from '../test-utils/player-boot';
import { ownTestBrowser } from '../test-utils/test-browser';
import { testEngines } from '../test-utils/test-engines';
import { vodVideoFixture, serveFixture } from '../test-utils/video-fixtures';

const FIXTURE = vodVideoFixture({ title: 'Slider marker regression', pageTitle: 'Slider marker fixture' });
const THUMB = 12;

/**
 * Where a slider's thumb centre sits and where its marker sits, in page pixels from the bottom
 * of the rotated track. They agree when the marker is on the thumb's path for `markerValue`.
 */
async function markerOffsets(page: Page, sliderSelector: string, markerValue: number) {
  return page.evaluate(([selector, value, thumb]) => {
    const root = document.querySelector('#theater-everywhere-ui')!.shadowRoot!;
    const slider = root.querySelector<HTMLInputElement>(selector as string)!;
    const marker = root.querySelector<HTMLElement>(`${selector} ~ .theater-slider-marker`)!;
    slider.value = String(value);
    const track = slider.getBoundingClientRect();
    const dot = marker.getBoundingClientRect();
    const fraction = (Number(slider.value) - Number(slider.min)) / (Number(slider.max) - Number(slider.min));
    return {
      hidden: marker.hidden || dot.width === 0,
      thumbCentre: track.bottom - (thumb as number) / 2 - fraction * (track.height - (thumb as number)),
      markerCentre: dot.top + dot.height / 2,
      markerWidth: dot.width,
      markerHeight: dot.height,
      markerX: dot.left + dot.width / 2,
      trackX: track.left + track.width / 2
    };
  }, [sliderSelector, markerValue, THUMB] as const);
}

describe('vertical slider marker', () => {
  for (const engine of testEngines()) {
    for (const boost of [false, true]) {
      it(`sits on the thumb path for 1x and 100%${boost ? ' with the boost ceiling' : ''} in ${engine}`, { timeout: 60_000 }, async t => {
        const browser = await (await import('playwright'))[engine].launch({ headless: true });
        ownTestBrowser(t, browser);
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        await serveFixture(page, FIXTURE, 'http://slider-marker.test/');
        await bootPlayer(page, {
          settings: { keepControlsVisible: true, volumeBoostEnabled: boost },
          mainWorld: boost
        });
        await enterTheater(page);
        // Closed panels have no geometry; hover opens both in turn.
        await page.locator('.speed-btn').hover();
        const speed = await markerOffsets(page, '.theater-speed-slider', 3);
        assert.equal(speed.hidden, false);
        assert.ok(Math.abs(speed.markerCentre - speed.thumbCentre) < 0.75, `1x marker ${JSON.stringify(speed)}`);
        assert.ok(Math.abs(speed.markerX - speed.trackX) < 0.75);

        await page.locator('.volume-btn').hover();
        const volume = await markerOffsets(page, '.theater-volume-slider', 1);
        if (boost) {
          assert.equal(volume.hidden, false);
          assert.ok(Math.abs(volume.markerCentre - volume.thumbCentre) < 0.75, `100% marker ${JSON.stringify(volume)}`);
          assert.ok(Math.abs(volume.markerX - volume.trackX) < 0.75);
          // One marker shape for every slider.
          assert.deepEqual([volume.markerWidth, volume.markerHeight], [speed.markerWidth, speed.markerHeight]);
        } else {
          assert.equal(volume.hidden, true, '100% is the end of the track, so it carries no marker');
        }
      });
    }
  }
});
