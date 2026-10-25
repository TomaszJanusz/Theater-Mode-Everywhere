import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { chromium } from 'playwright';

import { playerStylesheets } from '../test-utils/player-boot';
import { sharedTestBrowser } from '../test-utils/test-browser';

const shadowCss = playerStylesheets().ui;

describe('caption overlay width', () => {
  const shared = sharedTestBrowser(chromium);

  it('wraps within the video frame, not within half of it', async t => {
    const page = await (await shared.newContext(t, { viewport: { width: 1200, height: 700 } })).newPage();
    // The player UI host is a layout-contained fixed frame the size of the video.
    await page.setContent(`<style>${shadowCss}</style>
      <div style="position:fixed;inset:0;width:1000px;height:600px;contain:layout">
        <div class="theater-caption-overlay visible">
          <div class="theater-caption-overlay-text">Ryan and he made a meme out of how many death threats he said he was receiving.</div>
        </div>
      </div>`);
    const { width, lines } = await page.evaluate(() => {
      const box = document.querySelector('.theater-caption-overlay-text') as HTMLElement;
      const rect = box.getBoundingClientRect();
      return { width: rect.width, lines: Math.round(rect.height / parseFloat(getComputedStyle(box).lineHeight)) };
    });
    assert.ok(width > 500, `caption box ${width}px is limited to half of the 1000px frame`);
    assert.ok(width <= 800.5, `caption box ${width}px exceeds 80% of the frame`);
    assert.equal(lines, 2);
  });
});
