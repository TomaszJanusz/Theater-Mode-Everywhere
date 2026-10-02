import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import ts from 'typescript';
import {
  isVimeoShowcaseStepHref,
  usableControlIndexes,
  type ObservedPlaylistControl
} from './playlist-nav';

function control(overrides: Partial<ObservedPlaylistControl> & Pick<ObservedPlaylistControl, 'provider'>): ObservedPlaylistControl {
  return {
    directionHint: null,
    ariaDisabled: null,
    disabled: false,
    className: '',
    inlineDisplay: '',
    computedDisplay: 'block',
    x: 0,
    width: 48,
    ...overrides
  };
}

describe('playlist navigation availability', () => {
  it('shows YouTube previous and next only when the player is offering them', () => {
    const playlist = [
      control({
        provider: 'youtube',
        directionHint: 'previous',
        ariaDisabled: 'false',
        className: 'ytp-prev-button ytp-button',
        computedDisplay: 'block'
      }),
      control({
        provider: 'youtube',
        directionHint: 'next',
        ariaDisabled: 'false',
        className: 'ytp-next-button ytp-button ytp-playlist-ui',
        computedDisplay: 'block'
      })
    ];
    assert.deepEqual(
      usableControlIndexes(playlist, 1280).map((entry) => entry.direction),
      ['previous', 'next']
    );

    const single = [
      control({
        provider: 'youtube',
        directionHint: 'previous',
        ariaDisabled: 'true',
        className: 'ytp-prev-button ytp-button',
        inlineDisplay: 'none',
        computedDisplay: 'none',
        width: 0
      }),
      control({
        provider: 'youtube',
        directionHint: 'next',
        ariaDisabled: 'false',
        className: 'ytp-next-button ytp-button ytp-playlist-ui',
        inlineDisplay: 'none',
        computedDisplay: 'none',
        width: 0
      })
    ];
    assert.deepEqual(usableControlIndexes(single, 1280), []);
  });

  it('keeps a YouTube playlist step that stays in the DOM while the control bar autohides', () => {
    const autohide = [
      control({
        provider: 'youtube',
        directionHint: 'previous',
        ariaDisabled: 'false',
        computedDisplay: 'block',
        width: 52
      }),
      control({
        provider: 'youtube',
        directionHint: 'next',
        ariaDisabled: 'false',
        className: 'ytp-next-button ytp-button ytp-playlist-ui',
        computedDisplay: 'block',
        width: 52
      })
    ];
    assert.deepEqual(
      usableControlIndexes(autohide, 1280).map((entry) => entry.direction),
      ['previous', 'next']
    );
  });

  it('follows PeerTube video.js disabled and hidden classes', () => {
    const playlistStart = [
      control({
        provider: 'videojs',
        directionHint: 'previous',
        className: 'vjs-previous-video vjs-disabled',
        computedDisplay: 'inline-block',
        width: 0
      }),
      control({
        provider: 'videojs',
        directionHint: 'next',
        className: 'vjs-next-video',
        computedDisplay: 'inline-block',
        width: 0
      })
    ];
    assert.deepEqual(
      usableControlIndexes(playlistStart, 1280).map((entry) => entry.direction),
      ['next']
    );

    const single = [
      control({
        provider: 'videojs',
        directionHint: 'previous',
        className: 'vjs-previous-video vjs-disabled vjs-hidden',
        computedDisplay: 'none'
      }),
      control({
        provider: 'videojs',
        directionHint: 'next',
        className: 'vjs-next-video',
        computedDisplay: 'inline-block',
        width: 0
      })
    ];
    assert.deepEqual(
      usableControlIndexes(single, 1280).map((entry) => entry.direction),
      ['next']
    );
  });

  it('hides Dailymotion steps while the player marks them disabled', () => {
    const waiting = [
      control({
        provider: 'dailymotion',
        directionHint: 'previous',
        disabled: true,
        className: 'prev_button video_button_icon',
        computedDisplay: 'block',
        width: 64
      }),
      control({
        provider: 'dailymotion',
        directionHint: 'next',
        disabled: true,
        className: 'next_button video_button_icon',
        computedDisplay: 'block',
        width: 64
      })
    ];
    assert.deepEqual(usableControlIndexes(waiting, 1280), []);

    const ready = [
      control({
        provider: 'dailymotion',
        directionHint: 'previous',
        disabled: true,
        className: 'prev_button video_button_icon'
      }),
      control({
        provider: 'dailymotion',
        directionHint: 'next',
        disabled: false,
        className: 'next_button video_button_icon',
        width: 64
      })
    ];
    assert.deepEqual(
      usableControlIndexes(ready, 1280).map((entry) => entry.direction),
      ['next']
    );
  });

  it('places Vimeo showcase steps by which edge of the player they occupy', () => {
    const first = [
      control({ provider: 'vimeo-showcase', x: 1208, width: 48 })
    ];
    assert.deepEqual(
      usableControlIndexes(first, 1280).map((entry) => entry.direction),
      ['next']
    );

    const middle = [
      control({ provider: 'vimeo-showcase', x: 1208, width: 48 }),
      control({ provider: 'vimeo-showcase', x: 24, width: 48 })
    ];
    const picked = usableControlIndexes(middle, 1280);
    assert.deepEqual(picked.map((entry) => entry.direction), ['previous', 'next']);
    assert.equal(picked[0]?.index, 1);
    assert.equal(picked[1]?.index, 0);
  });

  it('recognizes Vimeo showcase step links and ignores pagination', () => {
    assert.equal(isVimeoShowcaseStepHref('https://vimeo.com/showcase/1574596?video=5124854'), true);
    assert.equal(isVimeoShowcaseStepHref('/showcase/1574596?video=2782153'), true);
    assert.equal(isVimeoShowcaseStepHref('https://vimeo.com/showcase/1574596'), false);
    assert.equal(isVimeoShowcaseStepHref('https://vimeo.com/76979871'), false);
    assert.equal(isVimeoShowcaseStepHref(null), false);
  });
});

describe('playlist navigation DOM', () => {
  it('reads the host markup observed on YouTube, PeerTube, Dailymotion, and Vimeo', async () => {
    let executable = '';
    try {
      const { chromium } = await import('playwright');
      executable = chromium.executablePath();
      if (!existsSync(executable)) return;
      const source = readFileSync(new URL('./playlist-nav.ts', import.meta.url), 'utf8');
      const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
      }).outputText;
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        await page.setContent(`<!doctype html><body>
          <div id="movie_player">
            <video id="player"></video>
            <a class="ytp-prev-button ytp-button" role="button" aria-disabled="false">Previous</a>
            <a class="ytp-next-button ytp-button ytp-playlist-ui" role="button" aria-disabled="false" aria-label="Next (SHIFT+n)">Next</a>
            <button class="ytp-button ytp-endscreen-next" aria-label="Next" style="display:none">End</button>
          </div>
        </body>`, { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ content: compiled + '\nwindow.__playlist = { findPlaylistActions };', type: 'module' });
        const read = () => page.evaluate(() => {
          const api = (window as unknown as { __playlist: { findPlaylistActions: (root: ParentNode, video: HTMLVideoElement) => Array<{ direction: string; activate: () => void }> } }).__playlist;
          const video = document.querySelector('#player') as HTMLVideoElement;
          return api.findPlaylistActions(document, video).map((action) => action.direction);
        });
        assert.deepEqual(await read(), ['previous', 'next']);

        await page.evaluate(() => {
          const prev = document.querySelector('.ytp-prev-button') as HTMLElement;
          const next = document.querySelector('.ytp-next-button') as HTMLElement;
          prev.setAttribute('aria-disabled', 'true');
          prev.style.display = 'none';
          next.style.display = 'none';
        });
        assert.deepEqual(await read(), []);

        await page.setContent(`<!doctype html><body>
          <div class="video-js">
            <video id="player"></video>
            <button class="vjs-previous-video vjs-disabled" title="Previous video"></button>
            <button class="vjs-next-video" title="Next video"></button>
          </div>
        </body>`, { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ content: compiled + '\nwindow.__playlist = { findPlaylistActions };', type: 'module' });
        assert.deepEqual(await read(), ['next']);

        await page.setContent(`<!doctype html><body>
          <video id="player"></video>
          <button data-testid="button-previous-video" class="prev_button" disabled aria-label="Previous video"></button>
          <button data-testid="button-next-video" class="next_button" aria-label="Next video"></button>
        </body>`, { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ content: compiled + '\nwindow.__playlist = { findPlaylistActions };', type: 'module' });
        assert.deepEqual(await read(), ['next']);

        await page.setContent(`<!doctype html><body>
          <video id="player" width="304" height="143"></video>
          <button aria-label="Previous page">Page</button>
          <button aria-label="Next video" data-href="https://vimeo.com/showcase/1574596?video=5124854" style="position:fixed;left:1208px;top:328px;width:48px;height:48px"></button>
        </body>`, { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ content: compiled + '\nwindow.__playlist = { findPlaylistActions };', type: 'module' });
        assert.deepEqual(await read(), ['next']);

        const clicked = await page.evaluate(() => {
          const api = (window as unknown as { __playlist: { findPlaylistActions: (root: ParentNode) => Array<{ direction: string; activate: () => void }> } }).__playlist;
          let hits = 0;
          const button = document.querySelector('[data-href]') as HTMLButtonElement;
          button.addEventListener('click', () => { hits += 1; });
          api.findPlaylistActions(document).find((action) => action.direction === 'next')?.activate();
          return hits;
        });
        assert.equal(clicked, 1);
      } finally {
        await browser.close();
      }
    } catch (error) {
      if (!executable) return;
      throw error;
    }
  });
});
