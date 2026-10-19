import { testEngines } from '../../test-utils/test-engines';
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

for (const engine of testEngines()) describe(`${engine} generic title source`, () => {
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
        tiedWithFrame: read('<section><h1>Clip</h1><video></video><iframe></iframe></section>'),
        labelledBy: read('<span id="a">Night</span><span id="b">Drive</span><section><h1>Clip</h1><video aria-labelledby="a b"></video></section>'),
        microdata: read('<div itemscope itemtype="https://schema.org/VideoObject"><meta itemprop="name" content="Micro clip"><div itemprop="author" itemscope itemtype="https://schema.org/Person"><span itemprop="name">Author</span></div><video></video></div>')
      };
    });
    assert.equal(report.pageLevel, null);
    assert.equal(report.twoVideos, null);
    assert.equal(report.twoHeadings, null);
    assert.equal(report.tied, 'Clip');
    assert.equal(report.tiedWithFrame, 'Clip', 'unrelated frames do not weaken an inline video heading');
    assert.equal(report.labelledBy, 'Night Drive');
    assert.equal(report.microdata, 'Micro clip');
  });

  it('falls back from an embed to adjacent parent headings, tracks both URLs and releases parent observers', { timeout: 30_000 }, async (t) => {
    const browserType = (await import('playwright'))[engine];
    if (!existsSync(browserType.executablePath())) { t.skip(`${engine} not installed`); return; }
    const browser = await browserType.launch({ headless: true });
    ownTestBrowser(t, browser);
    const page = await browser.newPage();
    await page.route('https://streamsite.example/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body:
      new URL(route.request().url()).pathname.startsWith('/embed')
        ? '<title>Streamsite</title><h1>Example Show (1975) — S52E1</h1><video id="player"></video>'
        : '<title>Example Show S52E1 — Streamsite</title><main><h1>Example Show</h1><h1>Season 52 · Episode 1 — Episode name</h1><iframe src="/embed/a"></iframe></main>'
    }));
    await page.goto('https://streamsite.example/watch/a');
    const frame = page.frames().find((frame) => frame.url().includes('/embed/a'))!;
    await frame.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
    const report = await frame.evaluate(async () => {
      const api = (window as unknown as { PageTitleTest: Api }).PageTitleTest;
      const video = document.querySelector('video')!;
      const parentDoc = window.parent.document;
      const source = new api.GenericTitleSource(video, true);
      const published: Array<string | null> = [];
      let notify: (() => void) | undefined;
      const stop = source.observe(() => { published.push(source.read()); notify?.(); });
      const change = async (mutate: () => void) => {
        await new Promise<void>((resolve) => { notify = resolve; mutate(); });
        notify = undefined;
        return published.at(-1);
      };
      const out: Record<string, unknown> = { initial: source.read(), service: new api.GenericTitleSource(video, false).read() };
      const headings = parentDoc.querySelectorAll('h1');
      out.headingChange = await change(() => { headings[1].textContent = 'Season 52 · Episode 1 — Full episode name'; });
      out.labelPriority = await change(() => { video.title = 'Explicit clip'; });
      await change(() => { video.removeAttribute('title'); });

      window.parent.history.pushState({}, '', '/watch/b');
      out.parentNavigation = source.read();
      out.newParentTitle = await change(() => { parentDoc.title = 'Example Show S52E2 — Streamsite'; });
      out.newHeadings = await change(() => { headings[1].textContent = 'Season 52 · Episode 2 — Next episode'; });
      history.pushState({}, '', '/embed/b');
      out.embedNavigation = source.read();
      out.newEmbedTitle = await change(() => { document.title = 'Embedded episode B | Streamsite'; });
      out.localPriority = source.read();
      await change(() => { document.title = 'Streamsite'; });
      out.parentAfterEmbedNavigation = source.read();
      out.parentFresh = await change(() => { headings[1].textContent = 'Season 52 · Episode 2 — Updated episode'; });

      const replacement = parentDoc.createElement('h1');
      replacement.textContent = 'Season 52 · Episode 2 — Replacement';
      out.replacement = await change(() => { headings[1].replaceWith(replacement); });
      out.replacementObserved = await change(() => { replacement.textContent = 'Season 52 · Episode 2 — Final'; });

      // A matching parent VideoObject may identify the embed rather than the parent URL.
      out.schema = await change(() => {
        const script = parentDoc.createElement('script');
        script.type = 'application/ld+json';
        script.textContent = JSON.stringify({ '@type': 'VideoObject', name: 'Schema episode', embedUrl: location.href });
        parentDoc.head.append(script);
      });
      await change(() => { parentDoc.querySelector('script[type="application/ld+json"]')!.remove(); });

      await change(() => { parentDoc.title = 'Parent metadata | Streamsite'; });
      const divider = parentDoc.createElement('p');
      headings[0].after(divider);
      out.nonAdjacent = source.read();
      divider.remove();
      const otherPlayer = parentDoc.createElement('video');
      parentDoc.querySelector('main')!.append(otherPlayer);
      out.multiplePlayers = source.read();
      otherPlayer.remove();

      published.length = 0;
      parentDoc.head.append(parentDoc.createElement('style'));
      parentDoc.querySelector('main')!.append(parentDoc.createElement('button'));
      await Promise.resolve();
      out.unrelatedMutations = published.length;
      // Queued mutations must not publish after disposal, including parent events.
      replacement.textContent = 'Queued old title';
      stop();
      stop();
      published.length = 0;
      parentDoc.title = 'After cleanup';
      window.parent.dispatchEvent(new PopStateEvent('popstate'));
      video.dispatchEvent(new Event('loadedmetadata'));
      await Promise.resolve();
      out.afterCleanup = published.length;
      video.remove();
      out.detached = source.read();
      return out;
    });
    assert.equal(report.initial, 'Example Show Season 52 · Episode 1 — Episode name');
    assert.equal(report.service, null);
    assert.equal(report.headingChange, 'Example Show Season 52 · Episode 1 — Full episode name');
    assert.equal(report.labelPriority, 'Explicit clip');
    assert.equal(report.parentNavigation, null);
    assert.equal(report.newParentTitle, 'Example Show S52E2');
    assert.equal(report.newHeadings, 'Example Show Season 52 · Episode 2 — Next episode');
    assert.equal(report.embedNavigation, null, 'an embed URL change also invalidates old parent values');
    assert.equal(report.newEmbedTitle, 'Embedded episode B');
    assert.equal(report.localPriority, 'Embedded episode B');
    assert.equal(report.parentAfterEmbedNavigation, null);
    assert.equal(report.parentFresh, 'Example Show Season 52 · Episode 2 — Updated episode');
    assert.equal(report.replacement, 'Example Show Season 52 · Episode 2 — Replacement');
    assert.equal(report.replacementObserved, 'Example Show Season 52 · Episode 2 — Final');
    assert.equal(report.schema, 'Schema episode');
    assert.equal(report.nonAdjacent, 'Parent metadata', 'separated headings are not combined');
    assert.equal(report.multiplePlayers, 'Parent metadata', 'headings in a multiple-player area are ambiguous');
    assert.equal(report.unrelatedMutations, 0);
    assert.equal(report.afterCleanup, 0);
    assert.equal(report.detached, null);
  });

  it('skips a cross-origin parent without throwing or publishing its title', { timeout: 30_000 }, async (t) => {
    const browserType = (await import('playwright'))[engine];
    if (!existsSync(browserType.executablePath())) { t.skip(`${engine} not installed`); return; }
    const browser = await browserType.launch({ headless: true });
    ownTestBrowser(t, browser);
    const page = await browser.newPage();
    await page.route('https://parent.example/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body:
      '<title>Private parent title</title><h1>Private heading</h1><iframe src="https://streamsite.example/embed"></iframe>' }));
    await page.route('https://streamsite.example/**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body:
      '<title>Streamsite</title><h1>Example Show (1975) — S52E1</h1><video></video>' }));
    await page.goto('https://parent.example/watch');
    const frame = page.frames().find((frame) => frame.url().includes('streamsite.example'))!;
    await frame.addScriptTag({ content: 'window.__name = fn => fn;' + bundle });
    const result = await frame.evaluate(() => {
      const api = (window as unknown as { PageTitleTest: Api }).PageTitleTest;
      const source = new api.GenericTitleSource(document.querySelector('video')!, true);
      const stop = source.observe(() => {});
      const title = source.read();
      stop();
      stop();
      return title;
    });
    assert.equal(result, null);
  });

});
