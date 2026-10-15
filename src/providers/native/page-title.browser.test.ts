import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ownTestBrowser } from '../../test-utils/test-browser';

const esbuild = createRequire(import.meta.url)('esbuild') as {
  buildSync(options: object): { outputFiles: { text: string }[] };
};
const bundle = esbuild.buildSync({ stdin: { resolveDir: new URL('../../', import.meta.url).pathname, loader: 'ts',
  contents: "export { GenericTitleSource } from './providers/native/page-title';" },
bundle: true, write: false, format: 'iife', globalName: 'PageTitleTest',
platform: 'browser', target: 'es2022', logLevel: 'silent' }).outputFiles[0].text;
type Api = typeof import('./page-title');

const FIXTURE = `<!doctype html><html><head>
  <title>Episode A | Example TV</title>
  <meta property="og:site_name" content="Example TV">
  <meta property="og:title" content="Episode A">
  <script type="application/ld+json">{"@type":"VideoObject","name":"Trailer","contentUrl":"https://cdn.example/trailer.mp4"}</script>
  </head><body>
  <h1>Example TV</h1>
  <article><h1 id="heading">Episode A</h1><div class="player"><video id="player"></video></div></article>
  <section id="related"><h2>Related</h2><video id="related-video"></video></section>
  </body></html>`;

for (const engine of ['chromium', 'firefox'] as const) describe(`${engine} generic title source`, () => {
  it('reads page fallbacks, waits for a client-side navigation to replace them and stops observing on cleanup', async (t) => {
    const browserType = (await import('playwright'))[engine];
    if (!existsSync(browserType.executablePath())) { t.skip(`${engine} not installed`); return; }
    const browser = await browserType.launch({ headless: true });
    ownTestBrowser(t, browser);
    const page = await browser.newPage();
    await page.route('https://videos.example/**', (route) => route.fulfill({ contentType: 'text/html', body: FIXTURE }));
    await page.goto('https://videos.example/watch/a');
    await page.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
    const report = await page.evaluate(async () => {
      const api = (window as unknown as { PageTitleTest: Api }).PageTitleTest;
      const settle = () => new Promise<void>((resolve) => queueMicrotask(() => setTimeout(resolve, 0)));
      const video = document.getElementById('player') as HTMLVideoElement;
      const source = new api.GenericTitleSource(video, true);
      const service = new api.GenericTitleSource(video, false);
      const published: Array<string | null> = [];
      const stop = source.observe(() => published.push(source.read()));
      const out: Record<string, unknown> = {};

      out.initial = source.read();
      out.withService = service.read();
      document.querySelector('meta[property="og:title"]')!.remove();
      out.documentTitle = source.read();
      document.title = 'Example TV';
      out.heading = source.read();
      document.getElementById('heading')!.textContent = 'Episode A (cut)';
      await settle();
      out.headingObserved = published.at(-1);

      // SPA: the URL names episode B before the page updates its head and heading.
      history.pushState({}, '', '/watch/b');
      out.afterPushState = source.read();
      published.length = 0;
      document.title = 'Episode B | Example TV';
      await settle();
      out.afterTitleSwap = published.slice();

      // A replaced <title> element is still observed after retargeting.
      published.length = 0;
      const replacement = document.createElement('title');
      replacement.textContent = 'Episode B — director’s cut';
      document.querySelector('title')!.replaceWith(replacement);
      await settle();
      replacement.textContent = 'Episode B — final';
      await settle();
      out.replacedTitle = published.slice();

      published.length = 0;
      document.head.append(document.createElement('style'));
      await settle();
      out.styleInsertions = published.length;

      // The element's own label and a matching VideoObject outrank the page.
      published.length = 0;
      video.src = 'https://cdn.example/trailer.mp4';
      out.videoObject = source.read();
      video.setAttribute('title', 'Labelled clip');
      await settle();
      out.elementTitle = published.at(-1);
      out.serviceElementTitle = service.read();

      stop();
      stop();
      published.length = 0;
      document.title = 'Episode C';
      video.setAttribute('title', 'Other clip');
      video.dispatchEvent(new Event('loadedmetadata'));
      await settle();
      out.afterCleanup = published.length;
      return out;
    });

    assert.equal(report.initial, 'Episode A', 'Open Graph outranks <title> and the heading; the trailer schema does not match');
    assert.equal(report.withService, null, 'pages with a service integration ignore page metadata');
    assert.equal(report.documentTitle, 'Episode A', 'the site name is removed from <title>');
    assert.equal(report.heading, 'Episode A', 'the article heading that shares a container with the video is the last resort');
    assert.equal(report.headingObserved, 'Episode A (cut)');
    assert.equal(report.afterPushState, null, 'the previous episode title is not shown under the new URL');
    assert.deepEqual(report.afterTitleSwap, ['Episode B']);
    assert.deepEqual(report.replacedTitle, ['Episode B — director’s cut', 'Episode B — final']);
    assert.equal(report.styleInsertions, 0, 'unrelated <head> insertions do not reread the title');
    assert.equal(report.videoObject, 'Trailer');
    assert.equal(report.elementTitle, 'Labelled clip');
    assert.equal(report.serviceElementTitle, 'Labelled clip');
    assert.equal(report.afterCleanup, 0, 'cleanup disconnects observers and media listeners');
  });

  it('uses a heading only when it is tied to one video', async (t) => {
    const browserType = (await import('playwright'))[engine];
    if (!existsSync(browserType.executablePath())) { t.skip(`${engine} not installed`); return; }
    const browser = await browserType.launch({ headless: true });
    ownTestBrowser(t, browser);
    const page = await browser.newPage();
    await page.setContent('<body></body>');
    await page.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
    const report = await page.evaluate(() => {
      const api = (window as unknown as { PageTitleTest: Api }).PageTitleTest;
      const read = (html: string) => {
        document.body.innerHTML = html;
        return new api.GenericTitleSource(document.querySelector('video')!, true).read();
      };
      return {
        pageLevel: read('<h1>Whole article</h1><video></video>'),
        twoVideos: read('<section><h1>Gallery</h1><video></video><video></video></section>'),
        twoHeadings: read('<section><h1>One</h1><h1>Two</h1><video></video></section>'),
        tied: read('<h1>Site</h1><section><h1>Clip</h1><div><video></video></div></section>'),
        labelledBy: read('<span id="a">Night</span><span id="b">Drive</span><section><h1>Clip</h1><video aria-labelledby="a b"></video></section>'),
        microdata: read('<div itemscope itemtype="https://schema.org/VideoObject"><meta itemprop="name" content="Micro clip"><div itemprop="author" itemscope itemtype="https://schema.org/Person"><span itemprop="name">Author</span></div><video></video></div>')
      };
    });
    assert.equal(report.pageLevel, null);
    assert.equal(report.twoVideos, null);
    assert.equal(report.twoHeadings, null);
    assert.equal(report.tied, 'Clip');
    assert.equal(report.labelledBy, 'Night Drive');
    assert.equal(report.microdata, 'Micro clip');
  });
});
