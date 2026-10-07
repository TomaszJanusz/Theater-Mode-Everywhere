import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';

const require = createRequire(import.meta.url);
const code = require('esbuild').buildSync({
  stdin: {
    contents: [
      "export { createServiceActions } from './providers/service-actions';",
      "export { createYouTubeServiceActions } from './providers/youtube/service-actions';",
      "export { createBilibiliServiceActions } from './providers/bilibili/service-actions';",
      "export { createBilibiliIntlServiceActions } from './providers/bilibili-intl/service-actions';",
      "export { nativePlaybackSurface } from './playback-surface';",
      "export { DisposableScope } from './core/disposable-scope';",
      "export { mountServiceActionCta } from './ui/service-actions';"
    ].join('\n'),
    resolveDir: path.resolve('src'), loader: 'ts'
  },
  bundle: true, write: false, format: 'iife', globalName: 'TeActions', platform: 'browser', target: 'es2022'
}).outputFiles[0].text as string;

let browser: Browser;
async function fixture(url: string, html: string): Promise<Page> {
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  await page.goto(url);
  await page.addScriptTag({ content: code });
  return page;
}

describe('YouTube and Bilibili service action providers', { skip: !existsSync(chromium.executablePath()) }, () => {
  before(async () => { browser = await chromium.launch({ headless: true }); });
  after(async () => { await browser?.close(); });

  it('proxies only available YouTube ad skips, including modern, legacy and embedded controls', async () => {
    const page = await fixture('https://www.youtube.com/watch?v=video1', '<div id="movie_player" class="html5-video-player ad-showing"><video></video></div>');
    try {
      const result = await page.evaluate(`(() => {
        const root = document.querySelector('#movie_player');
        const source = TeActions.createServiceActions({element:root.querySelector('video')});
        const labels = [];
        let clicks = 0;
        for (const name of ['ytp-skip-ad-button', 'ytp-ad-skip-button-modern', 'ytp-ad-skip-button']) {
          root.innerHTML = '<video></video><div class="ytp-ad-skip-button-container"><button class="' + name + '"><span>  Pomiń   reklamę  </span></button></div>';
          // Recreate for the current surface; a previous theater session must not own this one.
          const current = TeActions.createServiceActions({element:root.querySelector('video')});
          const button = root.querySelector('button');
          button.addEventListener('click', () => clicks++);
          const action = current.read()[0];
          labels.push(action.label);
          if (!current.activate(action.id)) throw Error('skip rejected');
          const check = (mutate, restore) => { mutate(); if (current.read().length || current.activate(action.id)) throw Error('unavailable skip'); restore(); };
          check(() => button.disabled = true, () => button.disabled = false);
          check(() => button.setAttribute('aria-disabled','true'), () => button.removeAttribute('aria-disabled'));
          check(() => button.setAttribute('aria-hidden','true'), () => button.removeAttribute('aria-hidden'));
          check(() => button.parentElement.setAttribute('aria-hidden','true'), () => button.parentElement.removeAttribute('aria-hidden'));
          check(() => button.parentElement.style.display = 'none', () => button.parentElement.style.display = '');
          check(() => button.parentElement.hidden = true, () => button.parentElement.hidden = false);
          check(() => root.classList.remove('ad-showing'), () => root.classList.add('ad-showing'));
          check(() => document.documentElement.setAttribute('data-te-youtube-integration-off',''), () => document.documentElement.removeAttribute('data-te-youtube-integration-off'));
          button.parentElement.style.cssText = 'visibility:hidden;opacity:0;pointer-events:none';
          if (current.read().length !== 1) throw Error('theater CSS hid action');
        }
        root.innerHTML = '<video></video><div class="ytp-ad-preview-container">Skip in 5</div><button class="ytp-next-button">Next</button>';
        const noSkip = TeActions.createServiceActions().read();
        history.replaceState(null,'','/embed/video1');
        root.innerHTML = '<video></video><button class="ytp-skip-ad-button" aria-label="Skip ad"></button>';
        const embedded = TeActions.createServiceActions().read()[0].label;
        return {labels, clicks, noSkip, embedded, oldSession:source.read()};
      })()`);
      assert.deepEqual(result, { labels: ['Pomiń reklamę', 'Pomiń reklamę', 'Pomiń reklamę'], clicks: 3, noSkip: [], embedded: 'Skip ad', oldSession: [] });
    } finally { await page.close(); }
  });

  it('rejects stale YouTube actions after route, button, root, media and source changes', async () => {
    const page = await fixture('https://www.youtube.com/watch?v=video1', '<div id="movie_player" class="ad-showing"><video src="a.mp4"></video><button class="ytp-skip-ad-button">Skip</button></div>');
    try {
      const result = await page.evaluate(`(() => {
        const source = TeActions.createServiceActions();
        const first = source.read()[0].id;
        history.replaceState(null,'','/watch?v=video1&utm_source=test');
        const trackingStable = source.read()[0].id === first;
        let clicks = 0;
        const rejected = [];
        const change = (mutate) => { const old = source.read()[0].id; mutate(); rejected.push(source.activate(old)); };
        change(() => history.replaceState(null,'','/watch?v=video2'));
        change(() => { const b=document.querySelector('button'); b.replaceWith(b.cloneNode(true)); });
        change(() => document.querySelector('video').setAttribute('src','b.mp4'));
        change(() => { const v=document.querySelector('video'); v.replaceWith(v.cloneNode(true)); });
        change(() => { const r=document.querySelector('#movie_player'); r.replaceWith(r.cloneNode(true)); });
        document.querySelector('button').addEventListener('click',()=>clicks++);
        const success = source.activate(source.read()[0].id);
        return {trackingStable,rejected,success,clicks};
      })()`);
      assert.deepEqual(result, { trackingStable: true, rejected: [false,false,false,false,false], success: true, clicks: 1 });
    } finally { await page.close(); }
  });

  it('proxies live Bilibili toast confirmations without exposing toolbar navigation or closing toasts', async () => {
    const page = await fixture('https://www.bilibili.com/bangumi/play/ep1?p=1', `<button class="bpx-player-toast-confirm">Outside</button><div class="bpx-player-container"><video></video>
      <button class="bpx-player-ctrl-next">Next</button>
      <div class="bpx-player-toast-row"><span class="bpx-player-toast-confirm">Closing</span></div>
      <div class="bpx-player-toast-row bpx-player-toast-unfold"><span class="bpx-player-toast-text">即将跳过片头</span><span class="bpx-player-toast-confirm">不跳过</span><span class="bpx-player-toast-cancel">×</span></div></div>`);
    try {
      const result = await page.evaluate(`(() => {
        const source=TeActions.createServiceActions();
        const button=document.querySelector('.bpx-player-toast-unfold .bpx-player-toast-confirm');
        let clicks=0; button.addEventListener('click',()=>clicks++);
        const first=source.read();
        const success=source.activate(first[0].id);
        button.textContent='仍然跳过';
        const relabelStale=source.activate(first[0].id);
        const changed=source.read()[0];
        history.replaceState(null,'','/bangumi/play/ep1?p=2');
        const partStale=source.activate(changed.id);
        const part=source.read()[0];
        button.parentElement.classList.remove('bpx-player-toast-unfold');
        const closing=source.read(); const closingStale=source.activate(part.id);
        button.parentElement.classList.add('bpx-player-toast-unfold');
        document.documentElement.setAttribute('data-te-bilibili-integration-off','');
        const off=source.read();
        return {labels:first.map(a=>a.label),success,clicks,relabelStale,partStale,closing,closingStale,off};
      })()`);
      assert.deepEqual(result, { labels:['不跳过'],success:true,clicks:1,relabelStale:false,partStale:false,closing:[],closingStale:false,off:[] });
    } finally { await page.close(); }
  });

  it('keeps Bilibili confirmations actionable inside the real toast wrapper hidden by theater layout', async () => {
    const page = await fixture('https://www.bilibili.com/bangumi/play/ep1', `<div class="bpx-player-container"><video></video>
      <div class="bpx-player-toast-wrap" style="display:none"><div class="bpx-player-toast-auto">
        <div class="bpx-player-toast-row bpx-player-toast-unfold"><div class="bpx-player-toast-item">
          <span class="bpx-player-toast-confirm">不跳过</span></div></div></div></div></div>`);
    try {
      await page.addStyleTag({ content: readFileSync('src/providers/bilibili/presentation.css', 'utf8') });
      const result = await page.evaluate(`(() => {
        const source=TeActions.createServiceActions();
        const button=document.querySelector('.bpx-player-toast-confirm');
        const row=button.closest('.bpx-player-toast-row');
        const wrap=button.closest('.bpx-player-toast-wrap');
        let clicks=0; button.addEventListener('click',()=>clicks++);
        const nativeHidden=source.read();
        document.documentElement.classList.add('theater-everywhere-html-active');
        const first=source.read()[0]; const activated=source.activate(first.id);
        const style=getComputedStyle(wrap); const presentation={display:style.display,visibility:style.visibility,opacity:style.opacity};
        const rejected=[];
        const check=(mutate,restore)=>{mutate();rejected.push(source.read().length===0 && !source.activate(first.id));restore();};
        check(()=>button.style.display='none',()=>button.style.display='');
        check(()=>row.style.display='none',()=>row.style.display='');
        check(()=>row.hidden=true,()=>row.hidden=false);
        check(()=>wrap.setAttribute('aria-hidden','true'),()=>wrap.removeAttribute('aria-hidden'));
        check(()=>row.classList.remove('bpx-player-toast-unfold'),()=>row.classList.add('bpx-player-toast-unfold'));
        check(()=>document.documentElement.setAttribute('data-te-bilibili-integration-off',''),()=>document.documentElement.removeAttribute('data-te-bilibili-integration-off'));
        document.documentElement.classList.remove('theater-everywhere-html-active');
        return {nativeHidden,label:first.label,activated,clicks,presentation,rejected,exited:source.read()};
      })()`);
      assert.deepEqual(result, { nativeHidden: [], label: '不跳过', activated: true, clicks: 1,
        presentation: { display: 'block', visibility: 'hidden', opacity: '0' }, rejected: [true,true,true,true,true,true], exited: [] });
    } finally { await page.close(); }
  });

  it('shows Bilibili.tv intro/outro only within current episode windows and next only near the end', async () => {
    const page = await fixture('https://www.bilibili.tv/en/play/1053337/11371243', '<div class="bstar-player"><video src="episode1.mp4"></video><div class="player-mobile-control-btn-next-episode"><div class="ip-next-episode"></div><div class="ip-tooltip">Next episode</div></div></div>');
    try {
      const result = await page.evaluate(`(() => {
        const root=document.documentElement; root.setAttribute('data-te-bilibili-intl-episode','11371243'); root.setAttribute('data-te-bilibili-intl-kind','ogv');
        const video=document.querySelector('video');
        Object.defineProperties(video,{duration:{value:1504,configurable:true},readyState:{value:4,configurable:true}});
        let context={mediaId:'ogv:11371243',chapters:[
          {start:99,end:227,title:'Intro',source:'bilibiliIntl',confidence:'high'},
          {start:1424,end:1504,title:'Outro',source:'bilibiliIntl',confidence:'high'}]};
        const seeks=[];
        const source=TeActions.createServiceActions({video:TeActions.nativePlaybackSurface(video),chapters:()=>context,label:key=>({skipIntro:'Pomiń czołówkę',skipOutro:'Pomiń napisy końcowe',nextVideo:'Dalej'})[key],seek:time=>{seeks.push(time);video.currentTime=time;}});
        video.currentTime=98; const before=source.read();
        video.currentTime=99; const intro=source.read()[0];
        const paused=video.paused; const activated=source.activate(intro.id); const pausedAfter=video.paused;
        const boundary=source.read(); const expired=source.activate(intro.id);
        video.currentTime=1424; const outro=source.read().map(a=>a.label);
        video.currentTime=1499; const nearEnd=source.read().map(a=>a.label);
        let nextClicks=0; const next=document.querySelector('.ip-next-episode'); next.addEventListener('click',()=>nextClicks++);
        source.activate(source.read()[1].id);
        next.classList.add('disabled'); const disabledNext=source.read().map(a=>a.label); next.classList.remove('disabled');
        video.currentTime=1504; const end=source.read().map(a=>a.label);
        video.currentTime=100; const stale=source.read()[0].id;
        root.setAttribute('data-te-bilibili-intl-episode','11371316');
        const mismatched=source.read(); const staleEpisode=source.activate(stale);
        history.replaceState(null,'','/en/play/1053337/11371316');
        const oldMetadata=source.read();
        context={...context,mediaId:'ogv:11371316'};
        const newEpisode=source.read().map(a=>a.label);
        document.documentElement.setAttribute('data-te-bilibili-intl-integration-off',''); const off=source.read();
        return {before,activated,paused,pausedAfter,seeks,boundary,expired,outro,nearEnd,nextClicks,disabledNext,end,mismatched,staleEpisode,oldMetadata,newEpisode,off};
      })()`);
      assert.deepEqual(result, { before:[],activated:true,paused:true,pausedAfter:true,seeks:[227],boundary:[],expired:false,outro:['Pomiń napisy końcowe'],nearEnd:['Pomiń napisy końcowe','Next episode'],nextClicks:1,disabledNext:['Pomiń napisy końcowe'],end:['Next episode'],mismatched:[],staleEpisode:false,oldMetadata:[],newEpisode:['Pomiń czołówkę'],off:[] });
    } finally { await page.close(); }
  });

  it('rejects Bilibili.tv upload, unready, seeking, invalid-window and replaced-surface actions', async () => {
    const page = await fixture('https://www.bilibili.tv/en/play/1053337', '<div class="bstar-player"><video></video></div>');
    try {
      const result = await page.evaluate(`(() => {
        document.documentElement.setAttribute('data-te-bilibili-intl-episode','11371243');
        const video=document.querySelector('video'); let ready=4, seeking=false;
        Object.defineProperties(video,{duration:{value:1504},readyState:{get:()=>ready},seeking:{get:()=>seeking}});
        video.currentTime=100;
        const good={start:99,end:227,title:'Intro',source:'bilibiliIntl',confidence:'high'};
        let chapters=[good];
        const source=TeActions.createServiceActions({video:TeActions.nativePlaybackSurface(video),chapters:()=>({mediaId:'ogv:11371243',chapters})});
        const id=source.read()[0].id;
        const rejected=[];
        for(const c of [{end:NaN},{end:Infinity},{end:90},{end:2000},{start:-1},{title:'Chapter'},{source:'youtube'},{confidence:'medium'}]) {
          chapters=[{...good,...c}]; rejected.push(source.read().length);
        }
        chapters=[good]; ready=0; const unready=source.activate(id); ready=4; seeking=true; const inSeek=source.activate(id); seeking=false;
        history.replaceState(null,'','/en/video/11371243'); const upload=source.read();
        history.replaceState(null,'','/en/play/1053337');
        video.replaceWith(video.cloneNode()); const replaced=source.activate(id);
        return {rejected,unready,inSeek,upload,replaced};
      })()`);
      assert.deepEqual(result,{rejected:[0,0,0,0,0,0,0,0],unready:false,inSeek:false,upload:[],replaced:false});
    } finally { await page.close(); }
  });

  it('accepts Bilibili.tv duration rounding slack and closes the window at the clamped end', async () => {
    const page = await fixture('https://www.bilibili.tv/en/play/1053337/11371243', '<div class="bstar-player"><video></video></div>');
    try {
      const result = await page.evaluate(`(() => {
        document.documentElement.setAttribute('data-te-bilibili-intl-episode','11371243');
        const video=document.querySelector('video');
        Object.defineProperties(video,{duration:{value:1504},readyState:{value:4}});
        video.currentTime=1450;
        let chapter={start:1424,end:1505,title:'Outro',source:'bilibiliIntl',confidence:'high'};
        const source=TeActions.createServiceActions({video:TeActions.nativePlaybackSurface(video),chapters:()=>({mediaId:'ogv:11371243',chapters:[chapter]})});
        const offered=source.read()[0];
        const success=source.activate(offered.id);
        const target=video.currentTime;
        const atEnd=source.read();
        const expired=source.activate(offered.id);
        video.currentTime=1450;
        chapter={...chapter,end:1505.001}; const pastSlack=source.read();
        chapter={...chapter,start:1504,end:1505}; const startsAtEnd=source.read();
        return {label:offered.label,success,target,atEnd,expired,pastSlack,startsAtEnd};
      })()`);
      assert.deepEqual(result,{label:'Skip outro',success:true,target:1504,atEnd:[],expired:false,pastSlack:[],startsAtEnd:[]});
    } finally { await page.close(); }
  });

  it('keeps a YouTube CTA mounted across idle chrome and disposes polling and nodes', async () => {
    const page = await fixture('https://www.youtube.com/watch?v=video1', '<div id="movie_player" class="ad-showing"><video></video><button class="ytp-skip-ad-button">Skip ad</button></div><div id="mount"></div>');
    try {
      await page.evaluate(`(() => {
        window.scope=new TeActions.DisposableScope(); window.clicks=0;
        document.querySelector('.ytp-skip-ad-button').addEventListener('click',()=>{window.clicks++;document.querySelector('#movie_player').classList.remove('ad-showing');});
        TeActions.mountServiceActionCta(scope,{source:TeActions.createServiceActions(),mount:e=>document.querySelector('#mount').append(e),toolbarVisible:()=>false,subscribeToolbar:()=>()=>{},controlsLift:()=>96,pollMs:10});
      })()`);
      await page.locator('.theater-service-action').waitFor();
      await page.evaluate("document.querySelector('#movie_player').style.cssText='visibility:hidden;opacity:0;pointer-events:none'");
      await page.locator('.theater-service-action').click();
      assert.equal(await page.evaluate('window.clicks'),1);
      assert.equal(await page.locator('.theater-service-action').count(),0);
      await page.evaluate('scope.dispose()');
      assert.equal(await page.locator('.theater-service-action-host').count(),0);
    } finally { await page.close(); }
  });
});
