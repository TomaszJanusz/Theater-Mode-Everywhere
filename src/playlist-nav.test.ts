import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { HOST_PLAYER_SCOPE } from './providers/navigation/factory';
import { usableControlIndexes, type ObservedPlaylistControl } from './providers/navigation/observed';
import { isVimeoShowcaseStepHref } from './providers/navigation/vimeo-showcase';
import { youtubePreviousRestarts } from './providers/navigation/youtube';
import {
  neighborPreviews,
  playlistNavStateFromActions,
  sanitizePlaylistPreview
} from './playlist-nav';

const require = createRequire(import.meta.url);
const SRC = path.dirname(fileURLToPath(import.meta.url));

type Esbuild = {
  buildSync: (options: {
    stdin: { contents: string; resolveDir: string; sourcefile: string; loader: 'ts' };
    bundle: true;
    write: false;
    format: 'iife';
    globalName: string;
    platform: 'browser';
    target: string;
    logLevel: 'silent';
  }) => { outputFiles: Array<{ text: string }> };
};

let playlistBundle: string | null = null;

function playlistBrowserBundle(): string {
  if (playlistBundle) return playlistBundle;
  const esbuild = require(createRequire(require.resolve('vite')).resolve('esbuild')) as Esbuild;
  playlistBundle = esbuild.buildSync({
    stdin: {
      contents: [
        "import { findPlaylistActions, neighborPreviews, sanitizePlaylistPreview } from './playlist-nav';",
        "import { peerTubeNeighborPreviews as readPeerTubeNeighborPreviews } from './providers/navigation/videojs';",
        "import { vimeoShowcasePreview as readVimeoShowcasePreview } from './providers/navigation/vimeo-showcase';",
        "import { installDisneyPlayNext } from './providers/disney/play-next';",
        'const helpers = { neighborPreviews, sanitizePreview: sanitizePlaylistPreview };',
        'export { findPlaylistActions, installDisneyPlayNext };',
        'export function peerTubeNeighborPreviews(root, href) { return readPeerTubeNeighborPreviews(root, href, helpers); }',
        'export function vimeoShowcasePreview(root, href) { return readVimeoShowcasePreview(root, href, helpers); }'
      ].join('\n'),
      resolveDir: SRC,
      sourcefile: 'playlist-nav-browser-entry.ts',
      loader: 'ts'
    },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'PlaylistNav',
    platform: 'browser',
    target: 'es2022',
    logLevel: 'silent'
  }).outputFiles[0].text;
  return playlistBundle;
}

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
  it('uses enabled Bilibili and Tencent steps and ignores placeholder controls', () => {
    const controls = [
      control({ provider: 'bilibili', directionHint: 'previous', className: 'bpx-player-ctrl-prev disabled' }),
      control({ provider: 'tencent', directionHint: 'next', className: 'txp_btn txp_none txp_disabled' }),
      control({ provider: 'tencent', directionHint: 'next', className: 'txp_btn txp_btn_next_u' })
    ];
    assert.deepEqual(usableControlIndexes(controls, 1280), [{ index: 2, direction: 'next' }]);
    assert.deepEqual(usableControlIndexes([
      control({ provider: 'bilibili', directionHint: 'previous' }),
      control({ provider: 'bilibili', directionHint: 'next', ariaDisabled: 'true' })
    ], 1280), [{ index: 0, direction: 'previous' }]);
    assert.deepEqual(usableControlIndexes([
      control({ provider: 'bilibiliIntl', directionHint: 'next', className: 'ip-next-episode disabled' })
    ], 1280), []);
    assert.deepEqual(usableControlIndexes([
      control({ provider: 'bilibiliIntl', directionHint: 'next', className: 'ip-next-episode' })
    ], 1280).map((entry) => entry.direction), ['next']);
  });
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

  it('treats a YouTube previous control without a preview as restarting the current video', () => {
    const button = (attrs: Record<string, string>) => ({
      getAttribute: (name: string) => attrs[name] ?? null
    });
    assert.equal(youtubePreviousRestarts(button({
      'data-preview': 'https://i.ytimg.com/vi/a/mqdefault.jpg',
      'data-tooltip-text': 'The essence of calculus'
    })), false);
    assert.equal(youtubePreviousRestarts(button({ 'data-tooltip-title': 'Replay' })), true);
    assert.deepEqual(playlistNavStateFromActions([{
      direction: 'previous',
      preview: null,
      restarts: true,
      activate() { /* host click */ }
    }]), {
      previous: true,
      next: false,
      previousRestarts: true,
      previousPreview: null,
      nextPreview: null
    });
  });

  it('keeps a playlist preview only when both a title and an https thumbnail exist', () => {
    assert.deepEqual(
      sanitizePlaylistPreview('  Derivative formulas  ', 'https://i.ytimg.com/vi/S0_qX4VJhMQ/mqdefault.jpg'),
      { title: 'Derivative formulas', imageUrl: 'https://i.ytimg.com/vi/S0_qX4VJhMQ/mqdefault.jpg' }
    );
    assert.equal(sanitizePlaylistPreview('Next', 'javascript:alert(1)'), null);
    assert.equal(sanitizePlaylistPreview('', 'https://i.ytimg.com/vi/x/mqdefault.jpg'), null);
    assert.equal(sanitizePlaylistPreview('Title', 'http://i.ytimg.com/vi/x/mqdefault.jpg'), null);
  });

  it('picks the previous and next publication by playlist position', () => {
    const items = [
      { position: 1, title: 'The essence of calculus', imageUrl: 'https://i.ytimg.com/vi/a/mqdefault.jpg' },
      { position: 2, title: 'The paradox of the derivative', imageUrl: 'https://i.ytimg.com/vi/b/mqdefault.jpg' },
      { position: 3, title: 'Derivative formulas', imageUrl: 'https://i.ytimg.com/vi/c/mqdefault.jpg' }
    ];
    assert.equal(neighborPreviews(items, 2).previous?.title, 'The essence of calculus');
    assert.equal(neighborPreviews(items, 2).next?.title, 'Derivative formulas');
    assert.equal(neighborPreviews(items, 1).previous, null);
    assert.equal(neighborPreviews(items, 3).next, null);
  });

  it('recognizes Vimeo showcase step links and ignores pagination', () => {
    assert.equal(isVimeoShowcaseStepHref('https://vimeo.com/showcase/1574596?video=5124854'), true);
    assert.equal(isVimeoShowcaseStepHref('/showcase/1574596?video=2782153'), true);
    assert.equal(isVimeoShowcaseStepHref('https://vimeo.com/showcase/1574596'), false);
    assert.equal(isVimeoShowcaseStepHref('https://vimeo.com/76979871'), false);
    assert.equal(isVimeoShowcaseStepHref('https://evil.example/showcase/1574596?video=1'), false);
    assert.equal(isVimeoShowcaseStepHref(null), false);
  });

  it('keeps the public navigation contract free of site selectors', () => {
    const source = readFileSync(new URL('./playlist-nav.ts', import.meta.url), 'utf8');
    assert.match(source, /from '\.\/providers\/navigation\/factory'/);
    assert.match(source, /export function findPlaylistActions\(root: ParentNode, video\?: HTMLVideoElement \| null\)/);
    assert.doesNotMatch(source, /providers\/navigation\/(?!factory)/);
    assert.doesNotMatch(source, /querySelector|closest\(|data-uia|ytp-|vjs-|bpx-|txp_|data-testid|data-href|getAttribute/);
  });

  it('preserves the host player scope used to find controls outside a passed video', () => {
    assert.equal(
      HOST_PLAYER_SCOPE,
      '#movie_player, .video-js, #player-wrapper, .bpx-player-container, .bilibili-player, #bilibiliPlayer, .bstar-player, .txp_player, #internal-player-wrapper'
    );
  });
});

describe('playlist navigation DOM', () => {
  it('reads the host markup observed on YouTube, PeerTube, Dailymotion, and Vimeo', async () => {
    let executable = '';
    try {
      const { chromium } = await import('playwright');
      executable = chromium.executablePath();
      if (!existsSync(executable)) return;
      const compiled = playlistBrowserBundle();
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const install = () => page.addScriptTag({ content: `${compiled}\nwindow.__playlist = PlaylistNav;` });
        await page.setContent(`<!doctype html><body>
          <div id="movie_player">
            <video id="player"></video>
            <a class="ytp-prev-button ytp-button" role="button" aria-disabled="false" data-preview="https://i.ytimg.com/vi/WUvTyaaNkzM/mqdefault.jpg" data-tooltip-text="The essence of calculus">Previous</a>
            <a class="ytp-next-button ytp-button ytp-playlist-ui" role="button" aria-disabled="false" aria-label="Next (SHIFT+n)" data-preview="https://i.ytimg.com/vi/S0_qX4VJhMQ/mqdefault.jpg" data-tooltip-text="Derivative formulas through geometry">Next</a>
            <button class="ytp-button ytp-endscreen-next" aria-label="Next" style="display:none">End</button>
          </div>
        </body>`, { waitUntil: 'domcontentloaded' });
        await install();
        const read = () => page.evaluate(() => {
          const api = (window as unknown as { __playlist: { findPlaylistActions: (root: ParentNode, video: HTMLVideoElement) => Array<{ direction: string; preview: { title: string } | null; activate: () => void }> } }).__playlist;
          const video = document.querySelector('#player') as HTMLVideoElement;
          return api.findPlaylistActions(document, video).map((action) => action.direction);
        });
        assert.deepEqual(await read(), ['previous', 'next']);
        const youtubePreviews = await page.evaluate(() => {
          const api = (window as unknown as { __playlist: { findPlaylistActions: (root: ParentNode, video: HTMLVideoElement) => Array<{ direction: string; preview: { title: string; imageUrl: string } | null }> } }).__playlist;
          const video = document.querySelector('#player') as HTMLVideoElement;
          return api.findPlaylistActions(document, video).map((action) => action.preview?.title ?? null);
        });
        assert.deepEqual(youtubePreviews, ['The essence of calculus', 'Derivative formulas through geometry']);

        await page.evaluate(() => {
          const prev = document.querySelector('.ytp-prev-button') as HTMLElement;
          const next = document.querySelector('.ytp-next-button') as HTMLElement;
          prev.setAttribute('aria-disabled', 'true');
          prev.style.display = 'none';
          next.style.display = 'none';
        });
        assert.deepEqual(await read(), []);

        await page.route('https://playlist.example/**', (route) => route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `<!doctype html><body>
            <div class="video-js" id="player-root">
              <video id="player"></video>
            </div>
            <button class="vjs-previous-video" title="Previous video"></button>
            <button class="vjs-next-video" title="Next video"></button>
            <div class="video">
              <img src="https://framatube.org/lazy-static/thumbnails/next.jpg" alt="">
              <a class="video-info-name" title="Making a libre movie" href="/w/p/list?playlistPosition=3">Making a libre movie</a>
            </div>
          </body>`
        }));
        await page.goto('https://playlist.example/w/p/list?playlistPosition=2', { waitUntil: 'domcontentloaded' });
        await install();
        const fromDocument = await page.evaluate(() => {
          const api = (window as unknown as { __playlist: { findPlaylistActions: (root: ParentNode, video: HTMLVideoElement) => Array<{ direction: string; preview: { title: string } | null }> } }).__playlist;
          const video = document.querySelector('#player') as HTMLVideoElement;
          const actions = api.findPlaylistActions(document, video);
          return {
            directions: actions.map((action) => action.direction),
            nextPreview: actions.find((action) => action.direction === 'next')?.preview?.title ?? null
          };
        });
        const fromPlayer = await page.evaluate(() => {
          const api = (window as unknown as { __playlist: { findPlaylistActions: (root: ParentNode, video: HTMLVideoElement) => Array<{ direction: string; preview: { title: string } | null }> } }).__playlist;
          const video = document.querySelector('#player') as HTMLVideoElement;
          const player = document.querySelector('#player-root') as HTMLElement;
          const actions = api.findPlaylistActions(player, video);
          return {
            directions: actions.map((action) => action.direction),
            nextPreview: actions.find((action) => action.direction === 'next')?.preview?.title ?? null
          };
        });
        assert.deepEqual(fromDocument.directions, ['previous', 'next']);
        assert.equal(fromDocument.nextPreview, 'Making a libre movie');
        assert.deepEqual(fromPlayer.directions, []);
        assert.equal(fromPlayer.nextPreview, null);

        await page.setContent(`<!doctype html><body>
          <div class="video-js">
            <video id="player"></video>
            <button class="vjs-previous-video vjs-disabled" title="Previous video"></button>
            <button class="vjs-next-video" title="Next video"></button>
          </div>
        </body>`, { waitUntil: 'domcontentloaded' });
        await install();
        assert.deepEqual(await read(), ['next']);
        await page.setContent(`<!doctype html><body>
          <div class="video">
            <img src="https://framatube.org/lazy-static/thumbnails/previous.jpg" alt="">
            <a class="video-info-name" title="Resurrecting Software Freedom Day" href="/w/p/list?playlistPosition=1">Resurrecting Software Freedom Day</a>
          </div>
          <div class="video">
            <img src="https://framatube.org/lazy-static/thumbnails/current.jpg" alt="">
            <a class="video-info-name" title="AI in a closing world" href="/w/p/list?playlistPosition=2">AI in a closing world</a>
          </div>
          <div class="video">
            <img src="https://framatube.org/lazy-static/thumbnails/next.jpg" alt="">
            <a class="video-info-name" title="Making a libre movie" href="/w/p/list?playlistPosition=3">Making a libre movie</a>
          </div>
        </body>`, { waitUntil: 'domcontentloaded' });
        await install();
        const peerTube = await page.evaluate(() => {
          const api = (window as unknown as { __playlist: { peerTubeNeighborPreviews: (root: ParentNode, href: string) => { previous: { title: string } | null; next: { title: string } | null } } }).__playlist;
          return api.peerTubeNeighborPreviews(document, 'https://framatube.org/w/p/list?playlistPosition=2');
        });
        assert.equal(peerTube.previous?.title, 'Resurrecting Software Freedom Day');
        assert.equal(peerTube.next?.title, 'Making a libre movie');

        await page.setContent(`<!doctype html><body>
          <div id="player-wrapper">
            <video id="player"></video>
            <button data-testid="button-previous-video" class="prev_button" disabled aria-label="Previous video"></button>
            <button data-testid="button-next-video" class="next_button" aria-label="Next video"></button>
          </div>
          <button id="stray-next" class="next_button" aria-label="Next page"></button>
        </body>`, { waitUntil: 'domcontentloaded' });
        await install();
        assert.deepEqual(await read(), ['next']);
        const dailymotionClick = await page.evaluate(() => {
          const api = (window as unknown as { __playlist: { findPlaylistActions: (root: ParentNode) => Array<{ direction: string; activate: () => void }> } }).__playlist;
          let stray = 0;
          let real = 0;
          document.getElementById('stray-next')?.addEventListener('click', () => { stray += 1; });
          document.querySelector('#player-wrapper .next_button')?.addEventListener('click', () => { real += 1; });
          api.findPlaylistActions(document).find((action) => action.direction === 'next')?.activate();
          return { stray, real };
        });
        assert.deepEqual(dailymotionClick, { stray: 0, real: 1 });

        await page.setContent(`<!doctype html><body>
          <video id="player" width="304" height="143"></video>
          <button aria-label="Previous page">Page</button>
          <button aria-label="Next video" data-href="https://vimeo.com/showcase/1574596?video=5124854" style="position:fixed;left:1208px;top:328px;width:48px;height:48px"></button>
          <a href="https://vimeo.com/showcase/1574596?video=5124854">
            <img src="https://i.vimeocdn.com/video/17932561-example-d_360x203?r=pad" alt="">
            <img src="https://i.vimeocdn.com/portrait/1_72x72" alt="Author">
            <p>AS ONE</p>
            <p>makoto yabuki</p>
          </a>
        </body>`, { waitUntil: 'domcontentloaded' });
        await install();
        assert.deepEqual(await read(), ['next']);
        const vimeoTitle = await page.evaluate(() => {
          const api = (window as unknown as { __playlist: { findPlaylistActions: (root: ParentNode) => Array<{ preview: { title: string } | null }> } }).__playlist;
          return api.findPlaylistActions(document)[0]?.preview?.title ?? null;
        });
        assert.equal(vimeoTitle, 'AS ONE');

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

  it('uses the native Netflix toolbar Next control and refuses a stale click', async () => {
    let executable = '';
    try {
      const { chromium } = await import('playwright');
      executable = chromium.executablePath();
      if (!existsSync(executable)) return;
      const compiled = playlistBrowserBundle();
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        await page.route('https://www.netflix.com/**', (route) => {
          if (route.request().resourceType() !== 'document') return route.abort();
          return route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><html><body></body></html>'
          });
        });
        await page.goto('https://www.netflix.com/watch/70248290?trackId=13752289', { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ content: `${compiled}\nwindow.__playlist = PlaylistNav;` });
        const report = await page.evaluate(`(() => {
          const api = window.__playlist;
          const toolbar = '<button type="button" data-uia="control-next" id="ghost" style="display:none"></button>'
            + '<div style="visibility:hidden;opacity:0;pointer-events:none">'
            + '<button type="button" data-uia="control-back"></button>'
            + '<button type="button" data-uia="control-prev"></button>'
            + '<button type="button" data-uia="control-next" id="live"></button>'
            + '</div>'
            + '<button type="button" data-uia="next-episode-seamless-button" id="seamless">Next episode</button>'
            + '<a data-uia="control-next" href="/watch/70248291">Next</a>';
          const mount = (inner, videoId = '70248290') => {
            document.documentElement.removeAttribute('data-te-netflix-integration-off');
            document.body.innerHTML = '<video id="other"></video><div class="watch-video"><div data-uia="player" data-videoid="'
              + videoId + '">' + inner + '<video id="player"></video></div></div>';
          };
          const read = (video) => api.findPlaylistActions(document, video || null);
          const directions = (video) => read(video).map((action) => action.direction);
          const playerVideo = () => document.querySelector('#player');
          mount(toolbar);
          const ready = read(playerVideo());
          const ghost = document.querySelector('#ghost');
          const live = document.querySelector('#live');
          const seamless = document.querySelector('#seamless');
          const counts = { ghost: 0, live: 0, seamless: 0, back: 0, prev: 0 };
          ghost.addEventListener('click', () => { counts.ghost += 1; });
          live.addEventListener('click', () => { counts.live += 1; });
          seamless.addEventListener('click', () => { counts.seamless += 1; });
          document.querySelector('[data-uia="control-back"]').addEventListener('click', () => { counts.back += 1; });
          document.querySelector('[data-uia="control-prev"]').addEventListener('click', () => { counts.prev += 1; });
          const nativeClick = live.click.bind(live);
          let liveInvocations = 0;
          live.click = () => {
            liveInvocations += 1;
            nativeClick();
          };
          ready.find((action) => action.direction === 'next').activate();
          const single = {
            directions: ready.map((action) => action.direction),
            preview: ready[0] ? ready[0].preview : null,
            path: location.pathname,
            counts,
            liveInvocations
          };
          const previewNode = document.createElement('div');
          previewNode.id = 'theater-everywhere-netflix-next-preview';
          document.documentElement.appendChild(previewNode);
          const readPreview = (payload) => {
            previewNode.textContent = JSON.stringify(payload);
            return read(playerVideo())[0] ? read(playerVideo())[0].preview : null;
          };
          const matchedPreview = readPreview({
            videoId: '70248290',
            title: 'House of Cards · Rozdział 2',
            imageUrl: 'https://occ.example/thumb.webp'
          });
          const otherTitle = readPreview({
            videoId: '80057281',
            title: 'Inny odcinek',
            imageUrl: 'https://occ.example/other.webp'
          });
          const insecurePreview = readPreview({
            videoId: '70248290',
            title: 'House of Cards · Rozdział 2',
            imageUrl: 'http://occ.example/thumb.webp'
          });
          previewNode.remove();

          const heldNode = document.createElement('div');
          heldNode.id = 'theater-everywhere-netflix-next-preview';
          document.documentElement.appendChild(heldNode);
          mount('');
          heldNode.textContent = JSON.stringify({
            videoId: '70248290',
            available: true,
            title: 'House of Cards · Rozdział 2',
            imageUrl: 'https://occ.example/thumb.webp'
          });
          const heldDirections = directions(playerVideo());
          const heldPreview = read(playerVideo())[0] ? read(playerVideo())[0].preview : null;
          let nextRequests = 0;
          const onNext = (event) => {
            if (event.detail === '70248290') nextRequests += 1;
          };
          window.addEventListener('theater-everywhere-netflix-next', onNext);
          read(playerVideo()).find((action) => action.direction === 'next').activate();
          window.removeEventListener('theater-everywhere-netflix-next', onNext);
          heldNode.textContent = JSON.stringify({
            videoId: '80057281',
            available: true,
            title: 'Inny odcinek',
            imageUrl: 'https://occ.example/other.webp'
          });
          const heldOther = directions(playerVideo());
          heldNode.remove();
          const held = { directions: heldDirections, preview: heldPreview, requests: nextRequests, other: heldOther };

          mount('<div style="display:none"><button type="button" data-uia="control-next"></button></div>');
          const ancestorDisplayNone = directions(playerVideo());
          mount('<button type="button" data-uia="control-next" disabled></button>');
          const disabled = directions(playerVideo());
          mount('<button type="button" data-uia="control-next" aria-disabled="true"></button>');
          const ariaDisabled = directions(playerVideo());
          mount('<button type="button" data-uia="control-next" hidden></button>');
          const hiddenAttr = directions(playerVideo());
          mount(toolbar, '111');
          const mismatched = directions(playerVideo());
          document.body.innerHTML = '<button type="button" data-uia="control-next"></button>'
            + '<div class="watch-video"><div data-uia="player" data-videoid="70248290"><video id="player"></video></div></div>';
          const outside = directions(playerVideo());
          mount(toolbar);
          const otherVideo = directions(document.querySelector('#other'));
          const documentLevel = directions(null);

          mount(toolbar);
          const staleAction = read(playerVideo()).find((action) => action.direction === 'next');
          const original = document.querySelector('#live');
          let originalClicks = 0;
          let replacementClicks = 0;
          original.addEventListener('click', () => { originalClicks += 1; });
          const replacement = original.cloneNode(true);
          replacement.addEventListener('click', () => { replacementClicks += 1; });
          original.replaceWith(replacement);
          staleAction.activate();
          const replaced = { originalClicks, replacementClicks };
          read(playerVideo()).find((action) => action.direction === 'next').activate();
          const freshReplacementClicks = replacementClicks;

          mount(toolbar);
          const removedAction = read(playerVideo()).find((action) => action.direction === 'next');
          const removed = document.querySelector('#live');
          let removedClicks = 0;
          removed.addEventListener('click', () => { removedClicks += 1; });
          removed.remove();
          removedAction.activate();

          mount(toolbar);
          const flagged = read(playerVideo()).find((action) => action.direction === 'next');
          const flaggedButton = document.querySelector('#live');
          let flagClicks = 0;
          flaggedButton.addEventListener('click', () => { flagClicks += 1; });
          document.documentElement.setAttribute('data-te-netflix-integration-off', '');
          flagged.activate();
          const flagOff = { clicks: flagClicks, directions: directions(playerVideo()) };

          document.documentElement.removeAttribute('data-te-netflix-integration-off');
          mount(toolbar);
          const routed = read(playerVideo()).find((action) => action.direction === 'next');
          const routedButton = document.querySelector('#live');
          let routeClicks = 0;
          routedButton.addEventListener('click', () => { routeClicks += 1; });
          history.pushState(null, '', '/watch/80057281');
          routed.activate();
          const routeOnly = routeClicks;
          document.querySelector('[data-uia="player"]').setAttribute('data-videoid', '80057281');
          routed.activate();
          const reusedTitle = routeClicks;

          return {
            single,
            otherVideo,
            documentLevel,
            ancestorDisplayNone,
            disabled,
            ariaDisabled,
            hiddenAttr,
            mismatched,
            outside,
            replaced,
            freshReplacementClicks,
            removedClicks,
            flagOff,
            routeOnly,
            reusedTitle,
            matchedPreview,
            otherTitle,
            insecurePreview,
            held
          };
        })()`) as {
          single: { directions: string[]; preview: { title: string } | null; path: string; counts: { ghost: number; live: number; seamless: number; back: number; prev: number }; liveInvocations: number };
          otherVideo: string[];
          documentLevel: string[];
          ancestorDisplayNone: string[];
          disabled: string[];
          ariaDisabled: string[];
          hiddenAttr: string[];
          mismatched: string[];
          outside: string[];
          replaced: { originalClicks: number; replacementClicks: number };
          freshReplacementClicks: number;
          removedClicks: number;
          flagOff: { clicks: number; directions: string[] };
          routeOnly: number;
          reusedTitle: number;
          matchedPreview: { title: string; imageUrl: string } | null;
          otherTitle: { title: string } | null;
          insecurePreview: { title: string } | null;
          held: { directions: string[]; preview: { title: string } | null; requests: number; other: string[] };
        };

        assert.deepEqual(report.single.directions, ['next']);
        assert.equal(report.single.preview, null);
        assert.equal(report.single.path, '/watch/70248290');
        assert.equal(report.single.liveInvocations, 1);
        assert.deepEqual(report.single.counts, { ghost: 0, live: 1, seamless: 0, back: 0, prev: 0 });
        assert.deepEqual(report.otherVideo, []);
        assert.deepEqual(report.documentLevel, ['next']);
        assert.deepEqual(report.ancestorDisplayNone, []);
        assert.deepEqual(report.disabled, []);
        assert.deepEqual(report.ariaDisabled, []);
        assert.deepEqual(report.hiddenAttr, []);
        assert.deepEqual(report.mismatched, []);
        assert.deepEqual(report.outside, []);
        assert.deepEqual(report.replaced, { originalClicks: 0, replacementClicks: 0 });
        assert.equal(report.freshReplacementClicks, 1);
        assert.equal(report.removedClicks, 0);
        assert.deepEqual(report.flagOff, { clicks: 0, directions: [] });
        assert.equal(report.routeOnly, 0);
        assert.equal(report.reusedTitle, 0);
        assert.deepEqual(report.matchedPreview, {
          title: 'House of Cards · Rozdział 2',
          imageUrl: 'https://occ.example/thumb.webp'
        });
        assert.equal(report.otherTitle, null);
        assert.equal(report.insecurePreview, null);
        assert.deepEqual(report.held.directions, ['next']);
        assert.equal(report.held.preview?.title, 'House of Cards · Rozdział 2');
        assert.equal(report.held.requests, 1);
        assert.deepEqual(report.held.other, []);
      } finally {
        await browser.close();
      }
    } catch (error) {
      if (!executable) return;
      throw error;
    }
  });

  it('uses the Disney control-bar next episode and leaves the end card alone', async () => {
    let executable = '';
    try {
      const { chromium } = await import('playwright');
      executable = chromium.executablePath();
      if (!existsSync(executable)) return;
      const compiled = playlistBrowserBundle();
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage();
        await page.route('https://www.disneyplus.com/**', (route) => {
          if (route.request().resourceType() !== 'document') return route.abort();
          return route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><html><body></body></html>'
          });
        });
        await page.goto('https://www.disneyplus.com/pl-pl/play/0c64c5db-0d1d-48c7-a6d6-8d2d56b16ca8', { waitUntil: 'domcontentloaded' });
        await page.addScriptTag({ content: `${compiled}\nwindow.__playlist = PlaylistNav;` });
        const report = await page.evaluate(`(() => {
          const api = window.__playlist;
          const play = '/pl-pl/play/0c64c5db-0d1d-48c7-a6d6-8d2d56b16ca8';
          const mount = (options) => {
            document.documentElement.removeAttribute('data-te-disney-integration-off');
            history.pushState({}, '', options.href || play);
            document.body.replaceChildren();
            const player = document.createElement('disney-web-player');
            const controls = document.createElement('main-app-controls-overlay');
            const host = document.createElement('play-next');
            host.hidden = options.hidden === true;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'play-next control';
            button.disabled = options.disabled === true;
            if (options.ariaDisabled) button.setAttribute('aria-disabled', 'true');
            button.addEventListener('click', () => { window.__playNextClicks = (window.__playNextClicks || 0) + 1; });
            host.attachShadow({ mode: 'open' }).append(button);
            const shadow = controls.attachShadow({ mode: 'open' });
            const frame = document.createElement('div');
            if (options.frameDisplay) frame.style.display = options.frameDisplay;
            frame.append(host);
            shadow.append(frame);
            const upNext = document.createElement('up-next-lite-v1');
            const upNextButton = document.createElement('button');
            upNextButton.className = 'up-next-lite-v1-overlay__button';
            upNextButton.textContent = 'Następny odcinek za 4';
            upNextButton.addEventListener('click', () => { window.__upNextClicks = (window.__upNextClicks || 0) + 1; });
            upNext.attachShadow({ mode: 'open' }).append(upNextButton);
            document.body.append(player, controls, upNext);
            return button;
          };
          const directions = () => api.findPlaylistActions(document).map((action) => action.direction);
          window.__playNextClicks = 0;
          window.__upNextClicks = 0;
          mount({});
          const ready = directions();
          api.findPlaylistActions(document).find((action) => action.direction === 'next').activate();
          const clicked = window.__playNextClicks;
          const emptyOverlay = document.createElement('main-app-controls-overlay');
          emptyOverlay.attachShadow({ mode: 'open' });
          const laterOverlayHost = document.createElement('main-app-controls-overlay');
          const laterPlayNext = document.createElement('play-next');
          const laterButton = document.createElement('button');
          laterButton.className = 'play-next control';
          laterButton.addEventListener('click', () => { window.__laterClicks = (window.__laterClicks || 0) + 1; });
          laterPlayNext.attachShadow({ mode: 'open' }).append(laterButton);
          laterOverlayHost.attachShadow({ mode: 'open' }).append(laterPlayNext);
          document.body.replaceChildren(emptyOverlay, laterOverlayHost);
          window.__laterClicks = 0;
          const laterOverlay = directions();
          api.findPlaylistActions(document).find((action) => action.direction === 'next').activate();
          const laterClicks = window.__laterClicks;
          const fromElement = api.findPlaylistActions(laterOverlayHost).map((action) => action.direction);
          const upNextClicks = window.__upNextClicks;
          mount({ frameDisplay: 'none' });
          const faded = directions();
          api.findPlaylistActions(document).find((action) => action.direction === 'next').activate();
          const fadedClicks = window.__playNextClicks;
          mount({ hidden: true });
          const hidden = directions();
          mount({ disabled: true });
          const disabled = directions();
          mount({ ariaDisabled: true });
          const ariaDisabled = directions();
          const playId = '0c64c5db-0d1d-48c7-a6d6-8d2d56b16ca8';
          const published = (options) => {
            mount(options);
            api.installDisneyPlayNext();
            return document.documentElement.getAttribute('data-te-disney-play-next');
          };
          const disabledPublished = published({ disabled: true });
          const hiddenPublished = published({ hidden: true });
          const ariaPublished = published({ ariaDisabled: true });
          const mountedPlayNext = () => document.querySelector('main-app-controls-overlay').shadowRoot.querySelector('play-next');
          mount({});
          const liveHost = mountedPlayNext();
          liveHost.primaryAction = () => { window.__primaryCalls = (window.__primaryCalls || 0) + 1; };
          api.installDisneyPlayNext();
          const livePublished = document.documentElement.getAttribute('data-te-disney-play-next');
          document.body.replaceChildren();
          api.installDisneyPlayNext();
          const heldPublished = document.documentElement.getAttribute('data-te-disney-play-next');
          window.__primaryCalls = 0;
          window.dispatchEvent(new CustomEvent('theater-everywhere-disney-play-next', { detail: playId }));
          const primaryAfterHide = window.__primaryCalls;
          mount({ disabled: true });
          mountedPlayNext().primaryAction = () => { window.__primaryCalls++; };
          api.installDisneyPlayNext();
          const blockedPublished = document.documentElement.getAttribute('data-te-disney-play-next');
          window.dispatchEvent(new CustomEvent('theater-everywhere-disney-play-next', { detail: playId }));
          const primaryWhileDisabled = window.__primaryCalls;
          mount({});
          document.documentElement.setAttribute('data-te-disney-integration-off', '');
          const flagged = directions();
          document.documentElement.removeAttribute('data-te-disney-integration-off');
          mount({ href: '/pl-pl/browse/home' });
          const browse = directions();
          history.pushState({}, '', play);
          const narrow = document.createElement('div');
          narrow.className = 'experience-controls-narrow';
          narrow.style.display = 'none';
          const narrowHost = document.createElement('play-next');
          const narrowButton = document.createElement('button');
          narrowButton.className = 'play-next control';
          narrowButton.addEventListener('click', () => { window.__narrowClicks = (window.__narrowClicks || 0) + 1; });
          narrowHost.attachShadow({ mode: 'open' }).append(narrowButton);
          narrow.append(narrowHost);
          const wide = document.createElement('div');
          wide.className = 'experience-controls';
          const wideHost = document.createElement('play-next');
          const wideButton = document.createElement('button');
          wideButton.className = 'play-next control';
          wideButton.addEventListener('click', () => { window.__wideClicks = (window.__wideClicks || 0) + 1; });
          wideHost.attachShadow({ mode: 'open' }).append(wideButton);
          wide.append(wideHost);
          const pairedControls = document.createElement('main-app-controls-overlay');
          pairedControls.attachShadow({ mode: 'open' }).append(narrow, wide);
          document.body.replaceChildren(pairedControls);
          window.__narrowClicks = 0;
          window.__wideClicks = 0;
          const paired = directions();
          api.findPlaylistActions(document).find((action) => action.direction === 'next').activate();
          const narrowClicks = window.__narrowClicks;
          const wideClicks = window.__wideClicks;
          wideHost.primaryAction = () => { window.__narrowRemainPrimary = (window.__narrowRemainPrimary || 0) + 1; };
          api.installDisneyPlayNext();
          wide.remove();
          api.installDisneyPlayNext();
          const narrowRemainsPublished = document.documentElement.getAttribute('data-te-disney-play-next');
          const narrowRemains = directions();
          window.__narrowRemainPrimary = 0;
          window.dispatchEvent(new CustomEvent('theater-everywhere-disney-play-next', { detail: playId }));
          const narrowRemainsPrimary = window.__narrowRemainPrimary;
          document.body.replaceChildren();
          document.documentElement.setAttribute('data-te-disney-play-next', '0c64c5db-0d1d-48c7-a6d6-8d2d56b16ca8');
          let heldClicks = 0;
          window.addEventListener('theater-everywhere-disney-play-next', (event) => {
            if (event.detail !== '0c64c5db-0d1d-48c7-a6d6-8d2d56b16ca8') return;
            heldClicks += 1;
            window.dispatchEvent(new CustomEvent('theater-everywhere-disney-play-next-ack', { detail: 'ok:' + event.detail }));
          });
          const held = directions();
          api.findPlaylistActions(document).find((action) => action.direction === 'next').activate();
          const heldActivated = heldClicks;
          document.documentElement.removeAttribute('data-te-disney-play-next');
          mount({});
          const stale = api.findPlaylistActions(document).find((action) => action.direction === 'next');
          history.pushState({}, '', '/pl-pl/play/11111111-1111-4111-8111-111111111111');
          const before = window.__playNextClicks;
          stale.activate();
          return { ready, clicked, laterOverlay, laterClicks, fromElement, upNextClicks, faded, fadedClicks, hidden, disabled, ariaDisabled, disabledPublished, hiddenPublished, ariaPublished, livePublished, heldPublished, primaryAfterHide, blockedPublished, primaryWhileDisabled, flagged, browse, paired, narrowClicks, wideClicks, narrowRemainsPublished, narrowRemains, narrowRemainsPrimary, held, heldActivated, staleClicks: window.__playNextClicks - before };
        })()`) as {
          ready: string[];
          clicked: number;
          laterOverlay: string[];
          laterClicks: number;
          fromElement: string[];
          upNextClicks: number;
          faded: string[];
          fadedClicks: number;
          hidden: string[];
          disabled: string[];
          ariaDisabled: string[];
          disabledPublished: string | null;
          hiddenPublished: string | null;
          ariaPublished: string | null;
          livePublished: string | null;
          heldPublished: string | null;
          primaryAfterHide: number;
          blockedPublished: string | null;
          primaryWhileDisabled: number;
          flagged: string[];
          browse: string[];
          paired: string[];
          narrowClicks: number;
          wideClicks: number;
          narrowRemainsPublished: string | null;
          narrowRemains: string[];
          narrowRemainsPrimary: number;
          held: string[];
          heldActivated: number;
          staleClicks: number;
        };
        assert.deepEqual(report.ready, ['next']);
        assert.equal(report.clicked, 1);
        assert.deepEqual(report.laterOverlay, ['next']);
        assert.equal(report.laterClicks, 1);
        assert.deepEqual(report.fromElement, ['next']);
        assert.equal(report.upNextClicks, 0);
        assert.deepEqual(report.faded, ['next']);
        assert.equal(report.fadedClicks, 2);
        assert.deepEqual(report.hidden, []);
        assert.deepEqual(report.disabled, []);
        assert.deepEqual(report.ariaDisabled, []);
        assert.equal(report.disabledPublished, null);
        assert.equal(report.hiddenPublished, null);
        assert.equal(report.ariaPublished, null);
        assert.equal(report.livePublished, '0c64c5db-0d1d-48c7-a6d6-8d2d56b16ca8');
        assert.equal(report.heldPublished, '0c64c5db-0d1d-48c7-a6d6-8d2d56b16ca8');
        assert.equal(report.primaryAfterHide, 1);
        assert.equal(report.blockedPublished, null);
        assert.equal(report.primaryWhileDisabled, 1);
        assert.deepEqual(report.flagged, []);
        assert.deepEqual(report.browse, []);
        assert.deepEqual(report.paired, ['next']);
        assert.equal(report.narrowClicks, 0);
        assert.equal(report.wideClicks, 1);
        assert.equal(report.narrowRemainsPublished, '0c64c5db-0d1d-48c7-a6d6-8d2d56b16ca8');
        assert.deepEqual(report.narrowRemains, ['next']);
        assert.equal(report.narrowRemainsPrimary, 1);
        assert.deepEqual(report.held, ['next']);
        assert.equal(report.heldActivated, 1);
        assert.equal(report.staleClicks, 0);
      } finally {
        await browser.close();
      }
    } catch (error) {
      if (!executable) return;
      throw error;
    }
  });
});
