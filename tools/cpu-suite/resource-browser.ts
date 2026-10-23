import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { Browser, CDPSession, Page } from 'playwright';
import type { Build } from './model';
import { verifyBuild } from './storage';
import { RESOURCE_PROBE, validateCounters, type Counters } from './resource-probe';
import { fixtureDocument, fixtureUrl, HIVE_STUB } from './resource-fixtures';
import { FIXTURES, phase, type Fixture, type ResourceSample } from './resource-model';
const ROOT = path.resolve(import.meta.dirname, '../..');
export async function fixtureServer() {
  const media = readFileSync(path.join(ROOT, 'test/fixtures/vod.webm'));
  let origin = '';
  const requests: { url: string; bytes: number; completed: boolean }[] = [];
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    if (request.url?.startsWith('/stream') || request.url?.startsWith('/timedtext')) {
      const record = { url: request.url, bytes: 0, completed: false }; requests.push(record);
      response.setHeader('Content-Type', request.url.startsWith('/timedtext') ? 'text/vtt' : 'application/octet-stream');
      const text = request.url.startsWith('/timedtext') ? 'WEBVTT\n\n00:00:00.000 --> 00:02:00.000\nfixture caption\n' : 'x'.repeat(4 * 1024 * 1024);
      const body = Buffer.from(text);
      for (let offset = 0; offset < body.length && !response.destroyed; offset += 65536) {
        const chunk = body.subarray(offset, offset + 65536); record.bytes += chunk.length;
        if (!response.write(chunk)) await new Promise<void>(resolve => {
          const finish = () => { response.off('drain', finish); response.off('close', finish); resolve(); };
          response.once('drain', finish); response.once('close', finish);
        });
      }
      record.completed = !response.destroyed; response.end(); return;
    }
    if (request.url === '/vod.webm') { response.setHeader('Content-Type', 'video/webm'); response.end(media); return; }
    const fixture = FIXTURES.find(name => request.url === `/${name}`);
    response.setHeader('Content-Type', 'text/html'); response.end(fixture ? fixtureDocument(fixture, origin) : '<!doctype html><html><body>frame fixture</body></html>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  origin = `http://127.0.0.1:${address.port}`;
  return { origin, requests, close: () => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
  }) };
}
const readCounters = async (page: Page): Promise<Counters> => {
  const result: unknown = await page.evaluate('window.__resourceProbe.snapshot()'); validateCounters(result); return result;
};
async function state(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(`(() => ({ href: location.href, theater: document.documentElement.classList.contains('theater-everywhere-html-active'),
    hidden: document.hidden, rteOff: [...document.documentElement.attributes].filter(a => /integration-off/.test(a.name)).map(a => a.name),
    rteEnabled: ![...document.documentElement.attributes].some(a => /integration-off/.test(a.name)),
    video: (()=>{const v=document.querySelector('video');return v ? {paused:v.paused,readyState:v.readyState,error:v.error?.message ?? null,time:v.currentTime,muted:v.muted,playhead:v.dataset.teDisneyPlayhead} : null})(),
    chatMarked: !!document.querySelector('[data-theater-chat]'), chatHidden: !!document.querySelector('[data-theater-chat-hidden]'),
    videoCount: document.querySelectorAll('video').length, hive: window.__hive?.stats ? {...window.__hive.stats} : null,
    ui: !!document.getElementById('theater-everywhere-ui'), portals: document.querySelectorAll('.ReactModalPortal').length
  }))()`);
}
async function heapBytes(cdp: CDPSession | null): Promise<number | null> {
  if (!cdp) return null;
  const result = await cdp.send('Performance.getMetrics') as { metrics: { name: string; value: number }[] };
  return result.metrics.find(m => m.name === 'JSHeapUsedSize')?.value ?? null;
}
export async function runFixture(browser: Browser, build: Build, fixture: Fixture, origin: string, cycles: number, round: number, heapDir?: string): Promise<ResourceSample> {
  const sample: ResourceSample = { fixture, build, round, accepted: false, reason: null, phases: [], errors: [], heap: null };
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const watchdog = setTimeout(() => { void context.close(); }, 30000);
  let cdp: CDPSession | null = null;
  const page = await context.newPage();
  const retention = async (label: string, snapshot = false) => {
    if (!heapDir || !cdp) return;
    await cdp.send('HeapProfiler.collectGarbage');
    const value = { bytes: await heapBytes(cdp), dom: await cdp.send('Memory.getDOMCounters'), snapshot: null as string | null };
    if (snapshot) {
      const file = path.join(heapDir, `${fixture}-${build.id}-${round}-${label}.heapsnapshot`);
      const chunks: string[] = []; const receive = (event: { chunk: string }) => chunks.push(event.chunk);
      cdp.on('HeapProfiler.addHeapSnapshotChunk', receive);
      try { await cdp.send('HeapProfiler.takeHeapSnapshot'); } finally { cdp.off('HeapProfiler.addHeapSnapshotChunk', receive); }
      writeFileSync(file, chunks.join('')); value.snapshot = file;
    }
    sample.heap = { ...sample.heap, [label]: value };
  };
  page.on('pageerror', error => sample.errors.push(String(error)));
  const checkpoint = async (name: string, action: () => Promise<unknown>) => {
    const input = await state(page), before = await readCounters(page); await action();
    // Flush mutation delivery/microtasks by crossing a browser task boundary, without advancing clock.
    await page.evaluate('Promise.resolve()');
    const after = await readCounters(page), observed = await state(page);
    sample.phases.push(phase(name, before, after, observed, await heapBytes(cdp), input));
    if (!observed.rteEnabled) throw new Error('Fixture RTE unexpectedly disabled');
    if (name === 'exit-cleanup' || name === 'exit') {
      if (observed.theater || observed.chatMarked) throw new Error('Theater/chat cleanup incomplete');
    }
  };
  try {
    verifyBuild(build);
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith(origin)) return route.continue();
      if (new URL(url).pathname === '/vod.webm') {
        const response = await fetch(`${origin}/vod.webm`);
        return route.fulfill({contentType:'video/webm',body:Buffer.from(await response.arrayBuffer())});
      }
      if (route.request().isNavigationRequest()) {
        const response = await fetch(`${origin}/${fixture}`);
        return route.fulfill({ contentType: 'text/html', body: await response.text() });
      }
      if (url.includes('/audit-stream') || url.includes('/api/timedtext')) {
        const response = await fetch(`${origin}/${url.includes('/api/timedtext') ? 'timedtext' : 'stream'}`);
        return route.fulfill({ contentType: url.includes('/api/timedtext') ? 'text/vtt' : 'application/octet-stream', body: Buffer.from(await response.arrayBuffer()) });
      }
      return route.abort();
    });
    await page.addInitScript(`window.__name = target => target;
      // Deliberately oppose chat-hidden's native state: native visibility must win on entry.
      const seed = {keepControlsVisible:true,youtubeIntegrationEnabled:true,twitchIntegrationEnabled:true,disneyIntegrationEnabled:true,nativeChatPreferences:{twitch:{visible:true,width:340,theme:'dark'}}};
      window.chrome = {storage:{sync:{get:async()=>seed,set:async patch=>Object.assign(seed,patch)}}};
`);
    await page.goto(fixtureUrl(fixture, origin));
    if (fixture !== 'generic-late-shadow') await page.evaluate(`Promise.all([...document.querySelectorAll('video')].map(v => v.readyState >= 1 ? Promise.resolve() : new Promise((resolve,reject)=>{v.addEventListener('loadedmetadata',resolve,{once:true});v.addEventListener('error',()=>reject(new Error('fixture media load failed')),{once:true});})))`);
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    // Clock replaces scheduler APIs; install wrappers afterwards, before either bundle.
    await page.evaluate(RESOURCE_PROBE);
    if (fixture.startsWith('disney-')) await page.evaluate(HIVE_STUB);
    if (fixture.startsWith('youtube-')) await page.evaluate(`Object.assign(document.getElementById('movie_player'), {
      getVideoData:()=>({video_id:'abcdefghijk'}),getPlayerResponse:()=>({videoDetails:{videoId:'abcdefghijk',title:'Fixture'}}),
      getPlaybackQuality:()=>'medium',getVolume:()=>100,getVideoStats:()=>({fmt:'fixture',afmt:'fixture',fps:30})
    })`);
    if (browser.browserType().name() === 'chromium') {
      cdp = await context.newCDPSession(page); await cdp.send('Performance.enable');
      if (heapDir) { await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.startSampling', { samplingInterval: 32768, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }); }
    }
    await checkpoint('startup', async () => {
      await page.addStyleTag({ path: path.join(build.path, 'content.css') });
      await page.addScriptTag({ content: `(function(){${readFileSync(path.join(build.path, 'mainWorld.js'), 'utf8')}\n})();` });
      await page.addScriptTag({ content: `(function(){${readFileSync(path.join(build.path, 'content.js'), 'utf8')}\n})();` });
      await page.clock.runFor(1000);
    });
    if (fixture === 'generic-mousemove') {
      await checkpoint('100-moves', () => page.evaluate(`(() => {const target=document.getElementById('target').firstElementChild.firstElementChild;for(let i=0;i<100;i++)target.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,composed:true}));})()`));
    } else if (fixture === 'generic-iframes') {
      await checkpoint('frame-startup', async () => {
        for (const frame of page.frames().slice(1)) {
          await frame.evaluate(RESOURCE_PROBE);
          await frame.addScriptTag({ content: `(function(){${readFileSync(path.join(build.path, 'mainWorld.js'), 'utf8')}\n})();` });
          await frame.addScriptTag({ content: `(function(){${readFileSync(path.join(build.path, 'content.js'), 'utf8')}\n})();` });
        }
        await page.clock.runFor(1000);
        const frameCounters = await Promise.all(page.frames().slice(1).map(frame => frame.evaluate('window.__resourceProbe.snapshot()')));
        sample.heap = { frameCounters, frameCount: frameCounters.length };
      });
    } else if (fixture === 'generic-late-shadow') {
      await checkpoint('late-video', async () => {
        await page.evaluate(`(() => { const host=document.getElementById('late');host.attachShadow({mode:'open'}).innerHTML='<video muted loop src="${origin}/vod.webm" style="width:960px;height:540px"></video>'; })()`);
        await page.evaluate(`(() => {const v=document.getElementById('late').shadowRoot.querySelector('video');return v.readyState >= 1 ? Promise.resolve() : new Promise((resolve,reject)=>{v.addEventListener('loadedmetadata',resolve,{once:true});v.addEventListener('error',()=>reject(new Error('shadow media load failed')),{once:true});});})()`);
        await page.clock.runFor(1000); await page.keyboard.press('t'); await page.clock.runFor(1000);
        if (!(await state(page)).theater) throw new Error('Late shadow theater not activated');
      });
      await checkpoint('exit', async () => { await page.keyboard.press('t'); await page.clock.runFor(1000); });
    } else if (fixture.startsWith('chat-')) {
      await page.keyboard.press('t'); await page.clock.runFor(1000);
      const observed = await state(page);
      if (!observed.theater || (fixture !== 'chat-absent' && !observed.chatMarked)) throw new Error('Chat/theater fixture not active');
      if (fixture === 'chat-hidden' && !observed.chatHidden) throw new Error('Chat fixture not hidden');
      await checkpoint('steady-4s', () => page.clock.runFor(4000));
      if (fixture !== 'chat-absent') await checkpoint('show-hide', async () => {
        await page.evaluate(`document.getElementById('theater-everywhere-ui').shadowRoot.querySelector('.theater-chat-toggle').click()`);
        await page.clock.runFor(1000);
        await page.evaluate(`document.getElementById('theater-everywhere-ui').shadowRoot.querySelector('.theater-chat-toggle').click()`);
        await page.clock.runFor(1000);
      });
      if (fixture === 'chat-portals') await retention('before-churn');
      if (fixture === 'chat-portals') for (let i = 0; i < cycles; i++) {
        await checkpoint(`portal-${i + 1}`, async () => {
          await page.evaluate(`(() => {const portal=document.createElement('div');portal.className='ReactModalPortal';portal.dataset.auditPortal='${i}';portal.innerHTML='<div class="NativeDark tw-root--theme-dark">portal</div>';document.body.append(portal);const select=document.getElementById('theater-everywhere-ui').shadowRoot.querySelector('.theater-chat-theme-select');select.value='${i % 2 ? 'dark' : 'light'}';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
          await page.clock.runFor(1000);
          const themed = await page.evaluate(`document.querySelector('.ReactModalPortal').classList.contains('tw-root--theme-${i % 2 ? 'dark' : 'light'}')`);
          if (!themed) throw new Error('Portal theme adapter was not exercised');
          await page.evaluate(`document.querySelector('.ReactModalPortal').remove()`); await page.clock.runFor(1000);
        });
      }
      if (fixture === 'chat-portals') await retention('after-churn', true);
      await checkpoint('exit-cleanup', async () => { await page.keyboard.press('t'); await page.clock.runFor(1000); });
      if (fixture === 'chat-portals') await retention('after-exit', true);
    } else if (fixture.startsWith('disney-')) {
      if (fixture !== 'disney-catalog') {
        await page.evaluate(`document.querySelector('video').play()`);
        await page.keyboard.press('t'); await page.clock.runFor(1000);
        if (!(await state(page)).theater) throw new Error('Disney theater not active');
      }
      if (fixture === 'disney-hidden') await page.evaluate(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'hidden'});document.dispatchEvent(new Event('visibilitychange'))`);
      await checkpoint('clock-4s', () => page.clock.runFor(4000));
      if (fixture === 'disney-pause-seek') await checkpoint('paused-seek', async () => {
        await page.evaluate(`(() => {document.querySelector('video').pause();window.dispatchEvent(new CustomEvent('theater-everywhere-media-seek',{detail:JSON.stringify({time:30,resumeAfterSeek:false})}));})()`);
        await page.clock.runFor(1000);
        const reached = await page.evaluate(`document.querySelector('video').paused && window.__hive.stats.seeks >= 1 && document.querySelector('video').dataset.teDisneyPlayhead === '30'`);
        if (!reached) throw new Error('Paused seek did not reach hive clock');
      });
      if (fixture === 'disney-spa') await checkpoint('spa-replacement', async () => {
        await page.evaluate(`(() => {history.pushState({},'', '/play/96e14fdb-3841-4282-ad38-07c8c4aab4b6');const host=document.querySelector('disney-web-player');host.replaceWith(host.cloneNode(true));window.dispatchEvent(new PopStateEvent('popstate'));})()`);
        await page.evaluate(HIVE_STUB); await page.clock.runFor(4000);
        if (!(await state(page)).theater) { await page.keyboard.press('t'); await page.clock.runFor(1000); }
        if (!(await state(page)).theater) throw new Error('Replacement theater not reactivated');
      });
      if (fixture !== 'disney-catalog') await checkpoint('exit-cleanup', async () => { await page.keyboard.press('t'); await page.clock.runFor(1000); });
    } else {
      await checkpoint('stream-read', async () => {
        await page.evaluate(`(async () => {const response=await fetch('${fixture === 'youtube-captions' ? 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&fmt=vtt' : 'https://www.youtube.com/audit-stream'}');window.__auditConsumed=(await response.arrayBuffer()).byteLength;})()`);
        await page.evaluate('window.__resourceProbe.idle()');
      });
    }
    if (heapDir && cdp) {
      const prefix = path.join(heapDir, `${fixture}-${build.id}-${round}`);
      const allocation = await cdp.send('HeapProfiler.stopSampling');
      writeFileSync(`${prefix}.allocations.json`, JSON.stringify(allocation));
      await cdp.send('HeapProfiler.collectGarbage');
      sample.heap = { ...sample.heap, postGcBytes: await heapBytes(cdp), allocations: `${prefix}.allocations.json` };

    }
    verifyBuild(build);
    if (sample.errors.length) throw new Error(sample.errors.join('\n'));
    sample.accepted = true;
  } catch (error) { sample.reason = String(error); }
  finally { clearTimeout(watchdog); await context.close(); }
  return sample;
}
