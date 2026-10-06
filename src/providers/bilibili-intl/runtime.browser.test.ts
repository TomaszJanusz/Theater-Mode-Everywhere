import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { chromium, type BrowserContext, type Page } from 'playwright';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname, '..');
const EXTENSION = path.join(ROOT, 'dist', 'chrome-unpacked');
const PAGE_URL = 'https://www.bilibili.tv/en/play/1053337';
const E1 = '11371243';
const E2 = '11371316';
const E2_PATH = `/en/play/1053337/${E2}`;
const FROM = 'bstar-web.pgc-video-detail.episode.manual';
const SPM = 'bstar-web.pgc-video-detail.0.0';
const ASS_URL = 'https://s.bstarstatic.com/ogv/subtitle/c350955fde09ca9f62098c78ddf0add4.ass?auth_key=fixture';
const JSON_URL = 'https://s.bstarstatic.com/ogv/subtitle/b57587f25806de4e30ce9d86394f30bc02844aed.json?auth_key=fixture';
const E2_URL = 'https://s.bstarstatic.com/ogv/subtitle/aa11bb22cc33dd44ee55ff6677889900.ass?auth_key=fixture';
const UGC_AID = E1;
const UGC_PATH = `/en/video/${UGC_AID}`;
const UGC_URL = 'https://p.bstarstatic.com/ugc/subtitle/1791206531_9b2afa9ce631f644_subtitle-1791206531413.json';
const UGC_SHEET = 'https://pic.bstarstatic.com/videoshot/ugcsheet.jpg';
const UGC_SPM = 'bstar-web.ugc-video-detail.0.0';
const ASS_CUE = 'Every object has its spirit, here.';
const JSON_CUE = 'لكل شيء روحه الخاصة.';
const E2_CUE = 'The second gate opens.';
const UGC_CUE = 'Uploaded line.';
const E1_TITLE = 'The Last Summoner E1';
const E2_TITLE = 'The Last Summoner E2';
const UGC_TITLE = 'Uploaded special';

const ASS_BODY = `[Script Info]
ScriptType: v4.00+
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,1:00:00.00,Default,,0,0,0,,{\\p1}m 0 0 l 1 1{\\p0}${ASS_CUE}
`;
const E2_BODY = `[Script Info]
ScriptType: v4.00+
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,1:00:00.00,Default,,0,0,0,,${E2_CUE}
`;
const JSON_BODY = JSON.stringify({ body: [{ from: 0, to: 3600, content: JSON_CUE }] });
const UGC_BODY = JSON.stringify({ body: [{ from: 0, to: 3600, content: UGC_CUE }] });
const SHOT_BIN = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x1e]);
const E1_SKIP = {
  opening_start_time: 99000,
  opening_end_time: 227000,
  ending_start_time: 1424000,
  ending_end_time: 1504000
};

type Hit = { url: string; status: number };
type FixtureWindow = Window & {
  __fixtureSentinel?: string;
  __probeCount?: number;
  __initialState?: unknown;
};

function extensionReady(): boolean {
  return existsSync(path.join(EXTENSION, 'content.js'))
    && existsSync(path.join(EXTENSION, 'mainWorld.js'))
    && existsSync(path.join(EXTENSION, 'manifest.json'));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const FIXTURE_MEDIA_URL = 'https://www.bilibili.tv/fixture-media.mp4';
let fixtureMediaPromise: Promise<Buffer> | null = null;

function fixtureMediaBytes(): Promise<Buffer> {
  fixtureMediaPromise ??= buildFixtureMedia().catch((error: unknown) => {
    fixtureMediaPromise = null;
    throw error;
  });
  return fixtureMediaPromise;
}

/** One decodable frame stretched to 1504s. MediaSource duration does not survive theater entry. */
async function buildFixtureMedia(): Promise<Buffer> {
  const browser = await chromium.launch({ headless: true, args: ['--headless=new', '--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.route('https://fixture.local/**', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>fixture</title>'
    }));
    await page.goto('https://fixture.local/');
    const encoded = await page.evaluate(`(async () => {
      const concat = (...parts) => {
        const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
        let offset = 0;
        for (const part of parts) {
          out.set(part, offset);
          offset += part.length;
        }
        return out;
      };
      const u16 = (value) => {
        const out = new Uint8Array(2);
        new DataView(out.buffer).setUint16(0, value);
        return out;
      };
      const u32 = (value) => {
        const out = new Uint8Array(4);
        new DataView(out.buffer).setUint32(0, value);
        return out;
      };
      const text = (value) => new TextEncoder().encode(value);
      const box = (type, payload) => concat(u32(8 + payload.length), text(type), payload);
      const full = (type, version, flags, payload) => {
        const head = new Uint8Array(4);
        new DataView(head.buffer).setUint32(0, (version << 24) | flags);
        return box(type, concat(head, payload));
      };
      const zeros = (length) => new Uint8Array(length);
      const matrix = concat(
        u32(0x00010000), u32(0), u32(0),
        u32(0), u32(0x00010000), u32(0),
        u32(0), u32(0), u32(0x40000000)
      );
      const canvas = new OffscreenCanvas(16, 16);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('fixture canvas missing');
      context.fillStyle = '#111';
      context.fillRect(0, 0, 16, 16);
      const frame = new VideoFrame(canvas, { timestamp: 0, duration: 1000000 });
      const chunks = [];
      const encoder = new VideoEncoder({
        output: (chunk, meta) => chunks.push({ chunk, meta }),
        error: (error) => { throw error; }
      });
      encoder.configure({
        codec: 'avc1.42001f',
        width: 16,
        height: 16,
        bitrate: 50000,
        avc: { format: 'avc' },
        latencyMode: 'quality'
      });
      encoder.encode(frame, { keyFrame: true });
      await encoder.flush();
      frame.close();
      encoder.close();
      const encodedChunk = chunks[0];
      const descriptionSource = encodedChunk && encodedChunk.meta.decoderConfig && encodedChunk.meta.decoderConfig.description;
      if (!encodedChunk || descriptionSource == null) throw new Error('fixture frame missing');
      const sample = new Uint8Array(encodedChunk.chunk.byteLength);
      encodedChunk.chunk.copyTo(sample);
      const description = new Uint8Array(descriptionSource);
      const timescale = 1000;
      const duration = 1504 * timescale;
      const ftyp = box('ftyp', concat(text('isom'), u32(0), text('isom'), text('avc1'), text('mp41')));
      const mvhd = full('mvhd', 0, 0, concat(
        u32(0), u32(0), u32(timescale), u32(duration),
        u32(0x00010000), u16(0x0100), u16(0), zeros(8), matrix, zeros(24), u32(2)
      ));
      const tkhd = full('tkhd', 0, 3, concat(
        u32(0), u32(0), u32(1), u32(0), u32(duration),
        zeros(8), u16(0), u16(0), u16(0), u16(0), matrix, u32(16 << 16), u32(16 << 16)
      ));
      const mdhd = full('mdhd', 0, 0, concat(u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0)));
      const hdlr = full('hdlr', 0, 0, concat(u32(0), text('vide'), zeros(12), text('VideoHandler\\0')));
      const vmhd = full('vmhd', 0, 1, concat(u16(0), u16(0), u16(0), u16(0)));
      const dinf = box('dinf', full('dref', 0, 0, concat(u32(1), full('url ', 0, 1, new Uint8Array()))));
      const avc1 = box('avc1', concat(
        zeros(6), u16(1), u16(0), u16(0), zeros(12),
        u16(16), u16(16), u32(0x00480000), u32(0x00480000),
        u32(0), u16(1), zeros(32), u16(0x0018), u16(0xffff), box('avcC', description)
      ));
      const stsd = full('stsd', 0, 0, concat(u32(1), avc1));
      const stts = full('stts', 0, 0, concat(u32(1), u32(1), u32(duration)));
      const stsc = full('stsc', 0, 0, concat(u32(1), u32(1), u32(1), u32(1)));
      const stsz = full('stsz', 0, 0, concat(u32(0), u32(1), u32(sample.length)));
      const stco = full('stco', 0, 0, concat(u32(1), u32(0)));
      const stbl = box('stbl', concat(stsd, stts, stsc, stsz, stco));
      const minf = box('minf', concat(vmhd, dinf, stbl));
      const moov = box('moov', concat(mvhd, box('trak', concat(tkhd, box('mdia', concat(mdhd, hdlr, minf))))));
      const file = concat(ftyp, moov, box('mdat', sample));
      new DataView(file.buffer).setUint32(ftyp.length + moov.length - 4, ftyp.length + moov.length + 8);
      let binary = '';
      for (let index = 0; index < file.length; index += 0x8000) {
        binary += String.fromCharCode(...file.subarray(index, index + 0x8000));
      }
      return btoa(binary);
    })()`) as string;
    return Buffer.from(encoded, 'base64');
  } finally {
    await browser.close();
  }
}

function pageHtml(): string {
  return `<!doctype html>
<html>
<head><title>Unrelated page - BiliBili</title></head>
<body>
  <div class="bstar-player">
    <video id="player" src="${FIXTURE_MEDIA_URL}" style="display:block;width:960px;height:540px;background:#111"></video>
    <div class="player-mobile-ass-subtitle">host ass</div>
    <div class="player-mobile-subtitle">host json</div>
    <div class="player-mobile-control-btn-next-episode">
      <button type="button" class="ip-next-episode">next episode</button>
    </div>
  </div>
  <script>
    window.__fixtureSentinel = 'page-main-only';
    window.__probeCount = 0;
    window.addEventListener('theater-everywhere-media-probe', () => { window.__probeCount += 1; });
    function pageRef(value) {
      const box = { __v_isRef: true, _value: value, _rawValue: value };
      Object.defineProperty(box, 'value', { get() { return box._value; }, enumerable: true });
      return box;
    }
    window.__initialState = {
      global: pageRef({ sLocale: pageRef('en') }),
      ogv: pageRef({
        epId: pageRef(${E1}),
        season: pageRef({ title: 'The Last Summoner' }),
        sectionsList: pageRef([{ episodes: [{ episode_id: ${E1}, title_display: 'E1' }] }])
      })
    };
    document.querySelector('.ip-next-episode').addEventListener('click', () => {
      const video = document.querySelector('video');
      history.pushState({}, '', ${JSON.stringify(`${E2_PATH}?bstar_from=${FROM}`)});
      window.__initialState = {
        global: { sLocale: 'en' },
        ogv: {
          epId: ${E2},
          season: { title: 'The Last Summoner' },
          sectionsList: [{ episodes: [{ episode_id: ${E2}, title_display: 'E2' }] }]
        }
      };
      video.dispatchEvent(new Event('timeupdate'));
      // The public player removes the element after the route changes, then
      // fires emptied while it is detached. No replacement video and no
      // durationchange follow. Do this before the probe can settle.
      document.querySelectorAll('.player-mobile-ass-subtitle, .player-mobile-subtitle').forEach((node) => node.remove());
      video.remove();
      video.dispatchEvent(new Event('emptied'));
    });
  </script>
</body>
</html>`;
}

function ugcPageHtml(): string {
  return `<!doctype html>
<html>
<head><title>${UGC_TITLE} - BiliBili</title></head>
<body>
  <div class="bstar-player">
    <video id="player" src="${FIXTURE_MEDIA_URL}" style="display:block;width:960px;height:540px;background:#111"></video>
    <div class="player-mobile-ass-subtitle">host ass</div>
    <div class="player-mobile-subtitle">host json</div>
  </div>
  <script>
    window.__fixtureSentinel = 'page-main-only';
    window.__probeCount = 0;
    window.addEventListener('theater-everywhere-media-probe', () => { window.__probeCount += 1; });
    function pageRef(value) {
      const box = { __v_isRef: true, _value: value, _rawValue: value };
      Object.defineProperty(box, 'value', { get() { return box._value; }, enumerable: true });
      return box;
    }
    window.__initialState = {
      global: pageRef({ sLocale: pageRef('en') }),
      ogv: pageRef({ epId: pageRef(''), season: null, sectionsList: pageRef([]) }),
      ugc: pageRef({
        aid: pageRef('${UGC_AID}'),
        archive: pageRef({ aid: '${UGC_AID}', title: '${UGC_TITLE}' })
      })
    };
  </script>
</body>
</html>`;
}

function officialQuery(url: string, episode: string, kind: 'subtitle' | 'shot' | 'episode'): boolean {
  const parsed = new URL(url);
  if (parsed.searchParams.get('s_locale') !== 'en_US') return false;
  if (parsed.searchParams.get('platform') !== 'web') return false;
  if (parsed.searchParams.get('episode_id') !== episode || parsed.searchParams.has('aid')) return false;
  const keys = [...parsed.searchParams.keys()].sort().join(',');
  if (kind === 'episode' || kind === 'shot') return keys === 'episode_id,platform,s_locale';
  return keys === 'episode_id,from_spm_id,platform,s_locale,spm_id'
    && parsed.searchParams.get('spm_id') === SPM
    && parsed.searchParams.get('from_spm_id') === (episode === E2 ? FROM : '');
}

function ugcQuery(url: string, aid: string, kind: 'subtitle' | 'shot'): boolean {
  const parsed = new URL(url);
  if (parsed.searchParams.get('s_locale') !== 'en_US') return false;
  if (parsed.searchParams.get('platform') !== 'web') return false;
  if (parsed.searchParams.get('aid') !== aid || parsed.searchParams.has('episode_id')) return false;
  const keys = [...parsed.searchParams.keys()].sort().join(',');
  if (kind === 'shot') return keys === 'aid,platform,s_locale';
  return keys === 'aid,from_spm_id,platform,s_locale,spm_id'
    && parsed.searchParams.get('spm_id') === UGC_SPM
    && parsed.searchParams.get('from_spm_id') === '';
}

function subtitlePayload(episode: string): string {
  const subtitles = episode === E1
    ? [
      { url: ASS_URL, lang: 'English', lang_key: 'en', subtitle_id: 1 },
      { url: JSON_URL, lang: 'عربي', lang_key: 'ar', subtitle_id: 2 }
    ]
    : [{ url: E2_URL, lang: 'Tiếng Việt', lang_key: 'vi', subtitle_id: 9 }];
  return JSON.stringify({ code: 0, data: { subtitles } });
}

function ugcSubtitlePayload(): string {
  return JSON.stringify({ code: 0, data: { subtitles: [
    { url: UGC_URL, lang: 'Upload track', lang_key: 'en', subtitle_id: 1 }
  ] } });
}

function ugcShotPayload(): string {
  return JSON.stringify({
    code: 0,
    data: {
      x_len: 2,
      y_len: 2,
      x_size: 160,
      y_size: 90,
      images: [UGC_SHEET],
      pv_data: 'https://pic.bstarstatic.com/videoshot/ugcsheet.bin'
    }
  });
}

function episodePayload(episode: string): string {
  return JSON.stringify({ code: 0, data: { skip: episode === E1 ? E1_SKIP : null } });
}

function shotPayload(episode: string): string {
  const name = episode === E1 ? 'e1sheet' : 'e2sheet';
  return JSON.stringify({
    code: 0,
    data: {
      x_len: 2,
      y_len: 2,
      x_size: 160,
      y_size: 90,
      images: [`https://pic.bstarstatic.com/videoshot/${name}.jpg`],
      pv_data: `https://pic.bstarstatic.com/videoshot/${name}.bin`
    }
  });
}

async function installFixtures(context: BrowserContext, hits: Hit[]): Promise<void> {
  const fulfill = async (
    route: { request: () => { url: () => string }; fulfill: (body: { status: number; contentType: string; body: string | Buffer }) => Promise<void> },
    status: number,
    contentType: string,
    body: string | Buffer
  ) => {
    hits.push({ url: route.request().url(), status });
    await route.fulfill({ status, contentType, body });
  };
  await context.route('https://www.bilibili.tv/**', async (route) => {
    if (route.request().url().split('?')[0] === FIXTURE_MEDIA_URL) {
      return fulfill(route, 200, 'video/mp4', await fixtureMediaBytes());
    }
    const html = route.request().url().includes('/video/') ? ugcPageHtml() : pageHtml();
    return fulfill(route, 200, 'text/html; charset=utf-8', html);
  });
  await context.route('https://api.bilibili.tv/**', (route) => {
    const url = route.request().url();
    if (url.includes('/playurl')) return fulfill(route, 200, 'application/json', '{"code":0,"data":{}}');
    const parsed = new URL(url);
    if (url.includes('/ogv/play/episode')) {
      const episode = parsed.searchParams.get('episode_id') || '';
      if ((episode !== E1 && episode !== E2) || !officialQuery(url, episode, 'episode')) {
        return fulfill(route, 412, 'text/html', '<html>blocked</html>');
      }
      return fulfill(route, 200, 'application/json', episodePayload(episode));
    }
    const kind = url.includes('/video/shot') ? 'shot' : url.includes('/subtitle') ? 'subtitle' : null;
    const episode = parsed.searchParams.get('episode_id') || '';
    const aid = parsed.searchParams.get('aid') || '';
    if (kind && (episode === E1 || episode === E2) && officialQuery(url, episode, kind)) {
      const body = kind === 'subtitle' ? subtitlePayload(episode) : shotPayload(episode);
      return fulfill(route, 200, 'application/json', body);
    }
    if (kind && aid === UGC_AID && ugcQuery(url, aid, kind)) {
      const body = kind === 'subtitle' ? ugcSubtitlePayload() : ugcShotPayload();
      return fulfill(route, 200, 'application/json', body);
    }
    return fulfill(route, 412, 'text/html', '<html>blocked</html>');
  });
  await context.route('https://p.bstarstatic.com/**', (route) => {
    const url = route.request().url();
    return fulfill(route, url === UGC_URL ? 200 : 404, 'application/json; charset=utf-8', url === UGC_URL ? UGC_BODY : 'missing');
  });
  await context.route('https://s.bstarstatic.com/**', (route) => {
    const url = route.request().url();
    const body = url === ASS_URL ? ASS_BODY : url === JSON_URL ? JSON_BODY : url === E2_URL ? E2_BODY : '';
    return fulfill(route, body ? 200 : 404, 'text/plain; charset=utf-8', body || 'missing');
  });
  await context.route('https://pic.bstarstatic.com/**', (route) => {
    const url = route.request().url();
    if (url.endsWith('.bin')) return fulfill(route, 200, 'application/octet-stream', SHOT_BIN);
    return fulfill(route, 200, 'image/gif', Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'));
  });
}

async function launchExtension(): Promise<{ context: BrowserContext; userData: string }> {
  const userData = mkdtempSync(path.join(tmpdir(), 'te-bilibili-intl-'));
  const context = await chromium.launchPersistentContext(userData, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      '--headless=new',
      '--lang=en-US',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`
    ]
  });
  await (context.serviceWorkers()[0] ? Promise.resolve() : context.waitForEvent('serviceworker'));
  return { context, userData };
}

async function dismissDialog(page: Page): Promise<void> {
  const button = page.locator('.te-dialog-btn-primary');
  if (await button.count()) await button.first().click();
}

type WorldRow = {
  origin: string;
  name: string;
  type: string;
  state: string;
  sentinel: string | null;
  runtime: boolean;
  chromeKeys: string;
};

async function watchWorlds(page: Page): Promise<() => Promise<WorldRow[]>> {
  const client = await page.context().newCDPSession(page);
  const contexts: Array<{ id: number; origin: string; name: string; type: string }> = [];
  client.on('Runtime.executionContextCreated', (event: { context: { id: number; origin: string; name?: string; auxData?: { type?: string } } }) => {
    contexts.push({
      id: event.context.id,
      origin: event.context.origin,
      name: event.context.name || '',
      type: event.context.auxData?.type || ''
    });
  });
  await client.send('Runtime.enable');
  return async () => {
    await delay(200);
    const rows: WorldRow[] = [];
    for (const context of contexts) {
      if (context.name.includes('__playwright')) continue;
      try {
        const evaluated = await client.send('Runtime.evaluate', {
          contextId: context.id,
          returnByValue: true,
          expression: `({
            state: typeof window.__initialState,
            sentinel: window.__fixtureSentinel || null,
            runtime: typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id),
            chromeKeys: typeof chrome === 'undefined' ? '' : Object.keys(chrome).slice(0, 12).join(',')
          })`
        }) as { result?: { value?: { state: string; sentinel: string | null; runtime: boolean; chromeKeys: string } } };
        const value = evaluated.result?.value;
        if (!value) continue;
        rows.push({ origin: context.origin, name: context.name, type: context.type, ...value });
      } catch {
        // A context can close between enumeration and evaluation.
      }
    }
    return rows;
  };
}

type PlayerUi = { title: string; cue: string; items: string[]; menuOpen: boolean };

async function readUi(page: Page): Promise<PlayerUi> {
  return page.evaluate(`(() => {
    const host = document.getElementById('theater-everywhere-ui');
    const root = host && host.shadowRoot;
    const read = (selector) => {
      const node = root && root.querySelector(selector);
      return node && node.textContent ? node.textContent.replace(/\\s+/g, ' ').trim() : '';
    };
    return {
      title: read('.theater-title-hud-text:not(.theater-title-hud-text-clone)'),
      cue: read('.theater-caption-overlay-text'),
      menuOpen: !!(root && root.querySelector('.theater-cc-menu.visible')),
      items: root ? Array.from(root.querySelectorAll('.theater-cc-menu-item')).map((node) => (
        node.textContent ? node.textContent.replace(/\\s+/g, ' ').trim() : ''
      )) : []
    };
  })()`) as Promise<PlayerUi>;
}

async function waitForMediaDuration(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return Boolean(video && video.readyState >= 1 && video.duration === 1504);
  });
}

async function waitFor(label: string, ready: () => Promise<boolean> | boolean, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await ready()) return;
    await delay(100);
  }
  throw new Error(label);
}

async function revealControls(page: Page): Promise<void> {
  await page.mouse.move(320, 240);
  await page.mouse.move(640, 700);
  await page.locator('.theater-controls-wrapper.visible').waitFor();
}

async function openCaptions(page: Page): Promise<void> {
  await revealControls(page);
  const menu = page.locator('.theater-cc-menu.visible');
  if (await menu.count()) return;
  await page.locator('.cc-btn').click();
  await menu.waitFor();
}

async function chooseCaption(page: Page, label: string | 'off'): Promise<void> {
  await openCaptions(page);
  const item = label === 'off'
    ? page.locator('.theater-cc-menu-item').first()
    : page.locator('.theater-cc-menu-item').filter({ hasText: label });
  await item.click();
}

type HostLayers = { hiddenAttr: boolean; theater: boolean; ass: string; json: string; episode: string | null; kind: string | null };

type Timeline = { marks: number; heatmap: boolean; preview: string; chapter: string };

async function hostLayers(page: Page): Promise<HostLayers> {
  return page.evaluate(`(() => {
    const root = document.documentElement;
    const ass = document.querySelector('.player-mobile-ass-subtitle');
    const json = document.querySelector('.player-mobile-subtitle');
    return {
      hiddenAttr: root.hasAttribute('data-te-bilibili-intl-captions-hidden'),
      theater: root.classList.contains('theater-everywhere-html-active'),
      ass: ass ? getComputedStyle(ass).display : '',
      json: json ? getComputedStyle(json).display : '',
      episode: root.getAttribute('data-te-bilibili-intl-episode'),
      kind: root.getAttribute('data-te-bilibili-intl-kind')
    };
  })()`) as Promise<HostLayers>;
}

async function readTimeline(page: Page): Promise<Timeline> {
  return page.evaluate(`(() => {
    const host = document.getElementById('theater-everywhere-ui');
    const root = host && host.shadowRoot;
    const preview = root && root.querySelector('.theater-scrubber-preview');
    const chapter = root && root.querySelector('.theater-scrubber-chapter-title');
    return {
      marks: root ? root.querySelectorAll('.theater-scrubber-chapter-mark').length : 0,
      heatmap: !!(root && root.querySelector('.theater-scrubber-heatmap-ready')),
      preview: preview ? String(preview.style.backgroundImage || '') : '',
      chapter: chapter && chapter.textContent ? chapter.textContent.trim() : ''
    };
  })()`) as Promise<Timeline>;
}

async function hoverScrubber(page: Page, ratio: number): Promise<void> {
  await revealControls(page);
  const box = await page.locator('.theater-scrubber-container').boundingBox();
  if (!box) throw new Error('scrubber missing');
  await page.mouse.move(box.x + Math.max(12, box.width * ratio), box.y + box.height / 2);
  await delay(250);
}

describe('bilibili.tv extension runtime', () => {
  it('reads hydrated page state on the first T, then the next episode', async (t) => {
    if (!extensionReady()) {
      t.skip('dist/chrome-unpacked is missing; run pnpm build');
      return;
    }
    const hits: Hit[] = [];
    const notes: string[] = [];
    const { context, userData } = await launchExtension();
    try {
      await installFixtures(context, hits);
      const page = context.pages()[0] || await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', (error) => notes.push(error.message));
      const worldsOf = await watchWorlds(page);
      await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const view = window as FixtureWindow;
        return document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts')
          && view.__probeCount === 0
          && view.__fixtureSentinel === 'page-main-only';
      });
      await dismissDialog(page);
      await delay(400);

      const before = await page.evaluate(() => {
        const view = window as FixtureWindow;
        return {
          probeCount: view.__probeCount,
          episode: document.documentElement.getAttribute('data-te-bilibili-intl-episode'),
          hidden: document.documentElement.hasAttribute('data-te-bilibili-intl-captions-hidden'),
          sentinel: view.__fixtureSentinel,
          state: typeof view.__initialState
        };
      });
      assert.equal(before.probeCount, 0);
      assert.equal(before.episode, null);
      assert.equal(before.hidden, false);
      assert.equal(before.sentinel, 'page-main-only');
      assert.equal(before.state, 'object');
      const prefetched = hits.filter((hit) => !hit.url.startsWith('https://www.bilibili.tv/'));
      assert.deepEqual(prefetched, []);

      const worlds = await worldsOf();
      const contentWorlds = worlds.filter((row) => (
        row.type === 'isolated' && row.runtime && row.origin.startsWith('chrome-extension://')
      ));
      assert.ok(contentWorlds.length > 0, `no extension content world: ${JSON.stringify(worlds)}`);
      assert.ok(
        contentWorlds.every((row) => row.state === 'undefined' && row.sentinel === null),
        JSON.stringify(contentWorlds)
      );

      await waitForMediaDuration(page);
      await page.keyboard.press('t');
      await page.waitForFunction(() => document.documentElement.classList.contains('theater-everywhere-html-active'));
      await waitFor(`title after T; hits ${JSON.stringify(hits)}; notes ${notes.join(' | ')}`, async () => (
        (await readUi(page)).title === E1_TITLE
      ));
      const opened = await hostLayers(page);
      assert.equal(opened.episode, E1);
      assert.equal(opened.hiddenAttr, false);
      assert.notEqual(opened.ass, 'none');
      assert.notEqual(opened.json, 'none');
      await waitFor(`E1 metadata; hits ${JSON.stringify(hits)}`, () => (
        hits.some((hit) => hit.status === 200 && hit.url.includes('/subtitle') && officialQuery(hit.url, E1, 'subtitle'))
        && hits.some((hit) => hit.status === 200 && hit.url.includes('/video/shot') && officialQuery(hit.url, E1, 'shot'))
        && hits.some((hit) => hit.status === 200 && hit.url.includes('/ogv/play/episode') && officialQuery(hit.url, E1, 'episode'))
      ));
      await waitForMediaDuration(page);
      await waitFor('E1 intro and outro marks', async () => {
        const timeline = await readTimeline(page);
        return timeline.marks === 2 && timeline.heatmap === false;
      });
      assert.equal((await hostLayers(page)).kind, 'ogv');
      await openCaptions(page);
      await waitFor('E1 tracks', async () => {
        const items = (await readUi(page)).items;
        return items.some((item) => item.includes('English')) && items.some((item) => item.includes('عربي'));
      });

      await chooseCaption(page, 'English');
      await waitFor(`ASS cue; hits ${JSON.stringify(hits)}`, async () => (await readUi(page)).cue === ASS_CUE);
      assert.ok(hits.some((hit) => hit.url === ASS_URL && hit.status === 200));
      const duringAss = await hostLayers(page);
      assert.equal(duringAss.hiddenAttr, true);
      assert.equal(duringAss.ass, 'none');
      assert.equal(duringAss.json, 'none');

      await chooseCaption(page, 'عربي');
      await waitFor(`JSON cue; hits ${JSON.stringify(hits)}`, async () => (await readUi(page)).cue === JSON_CUE);
      assert.ok(hits.some((hit) => hit.url === JSON_URL && hit.status === 200));

      await chooseCaption(page, 'off');
      await waitFor('captions off', async () => (await readUi(page)).cue === '');
      const off = await hostLayers(page);
      assert.equal(off.theater, true);
      assert.equal(off.hiddenAttr, true);
      assert.equal(off.ass, 'none');
      assert.equal(off.json, 'none');
      await openCaptions(page);
      const offMenu = await readUi(page);
      assert.match(offMenu.items[0] || '', /✓/);

      await page.keyboard.press('Escape');
      await page.locator('.theater-cc-menu').waitFor({ state: 'hidden' });
      assert.equal((await hostLayers(page)).theater, true);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
      const restored = await hostLayers(page);
      assert.equal(restored.theater, false);
      assert.equal(restored.hiddenAttr, false);
      assert.notEqual(restored.ass, 'none');
      assert.notEqual(restored.json, 'none');

      await page.keyboard.press('t');
      await page.waitForFunction(() => document.documentElement.classList.contains('theater-everywhere-html-active'));
      await revealControls(page);
      await page.locator('.playlist-next-btn').waitFor();
      await page.locator('.playlist-next-btn').click();
      await page.waitForFunction((path) => location.pathname === path, E2_PATH);
      await page.waitForFunction(() => !document.querySelector('video'));
      await waitFor(`E2 title; hits ${JSON.stringify(hits)}; notes ${notes.join(' | ')}`, async () => (
        (await readUi(page)).title === E2_TITLE
      ));
      const next = await hostLayers(page);
      assert.equal(next.theater, true);
      assert.equal(next.episode, E2);
      assert.equal(next.ass, '');
      assert.equal(next.json, '');
      await waitFor(`E2 metadata; hits ${JSON.stringify(hits)}`, () => (
        hits.some((hit) => hit.status === 200 && officialQuery(hit.url, E2, 'subtitle'))
        && hits.some((hit) => hit.status === 200 && officialQuery(hit.url, E2, 'shot'))
        && hits.some((hit) => hit.status === 200 && officialQuery(hit.url, E2, 'episode'))
      ));
      await waitFor('E2 drops the previous intro marks', async () => (await readTimeline(page)).marks === 0);
      await openCaptions(page);
      await waitFor('E2 tracks', async () => {
        const items = (await readUi(page)).items;
        return items.some((item) => item.includes('Tiếng Việt')) && items.every((item) => !item.includes('عربي'));
      });
      await chooseCaption(page, 'Tiếng Việt');
      await waitFor(`E2 cue; hits ${JSON.stringify(hits)}`, async () => (await readUi(page)).cue === E2_CUE);
      const duringE2 = await hostLayers(page);
      assert.equal(duringE2.hiddenAttr, true);
      assert.equal(hits.some((hit) => hit.url.includes('/playurl')), false);

      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.documentElement.classList.contains('theater-everywhere-html-active'));
      await page.evaluate(() => {
        const player = document.querySelector('.bstar-player');
        const ass = document.createElement('div');
        ass.className = 'player-mobile-ass-subtitle';
        ass.textContent = 'host ass';
        const json = document.createElement('div');
        json.className = 'player-mobile-subtitle';
        json.textContent = 'host json';
        player?.append(ass, json);
      });
      const exited = await hostLayers(page);
      assert.equal(exited.theater, false);
      assert.equal(exited.hiddenAttr, false);
      assert.notEqual(exited.ass, 'none');
      assert.notEqual(exited.json, 'none');
    } finally {
      await context.close();
      rmSync(userData, { recursive: true, force: true });
    }
  });

  it('reads an upload, then an episode with the same numeric id', async (t) => {
    if (!extensionReady()) {
      t.skip('dist/chrome-unpacked is missing; run pnpm build');
      return;
    }
    const hits: Hit[] = [];
    const notes: string[] = [];
    const { context, userData } = await launchExtension();
    try {
      await installFixtures(context, hits);
      const page = context.pages()[0] || await context.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', (error) => notes.push(error.message));
      await page.goto(`https://www.bilibili.tv${UGC_PATH}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-theater-everywhere-entry-shortcuts'));
      await dismissDialog(page);
      await waitForMediaDuration(page);
      await page.keyboard.press('t');
      await page.waitForFunction(() => document.documentElement.classList.contains('theater-everywhere-html-active'));
      await waitFor(`upload title; hits ${JSON.stringify(hits)}; notes ${notes.join(' | ')}`, async () => (
        (await readUi(page)).title === UGC_TITLE
      ));
      const uploaded = await hostLayers(page);
      assert.equal(uploaded.episode, UGC_AID);
      assert.equal(uploaded.kind, 'ugc');
      await waitFor('upload metadata', () => (
        hits.some((hit) => hit.status === 200 && ugcQuery(hit.url, UGC_AID, 'subtitle'))
        && hits.some((hit) => hit.status === 200 && ugcQuery(hit.url, UGC_AID, 'shot'))
        && hits.every((hit) => !hit.url.includes('/ogv/play/episode'))
      ));
      await openCaptions(page);
      await waitFor('upload track', async () => (await readUi(page)).items.some((item) => item.includes('Upload track')));
      await chooseCaption(page, 'Upload track');
      await waitFor(`upload cue; hits ${JSON.stringify(hits)}`, async () => (await readUi(page)).cue === UGC_CUE);
      assert.ok(hits.some((hit) => hit.url === UGC_URL && hit.status === 200));
      await hoverScrubber(page, 0.02);
      await waitFor('upload thumbnail', async () => (await readTimeline(page)).preview.includes('ugcsheet.jpg'));
      const uploadTimeline = await readTimeline(page);
      assert.equal(uploadTimeline.marks, 0);
      assert.equal(uploadTimeline.heatmap, false);
      assert.equal(uploadTimeline.chapter, '');

      await page.evaluate((episode) => {
        const video = document.querySelector('video');
        const view = window as FixtureWindow;
        history.pushState({}, '', '/en/play/1053337');
        view.__initialState = {
          global: { sLocale: 'en' },
          ogv: {
            epId: episode,
            season: { title: 'The Last Summoner' },
            sectionsList: [{ episodes: [{ episode_id: episode, title_display: 'E1' }] }]
          }
        };
        video?.dispatchEvent(new Event('timeupdate'));
      }, E1);
      await waitFor(`episode title after upload; hits ${JSON.stringify(hits)}; notes ${notes.join(' | ')}`, async () => (
        (await readUi(page)).title === E1_TITLE
      ));
      await waitFor('upload cue leaves the episode', async () => (await readUi(page)).cue !== UGC_CUE);
      const episode = await hostLayers(page);
      assert.equal(episode.kind, 'ogv');
      assert.equal(episode.episode, E1);
      await waitFor('episode skip request', () => (
        hits.some((hit) => hit.status === 200 && officialQuery(hit.url, E1, 'episode'))
      ));
      await waitFor('intro and outro marks', async () => (await readTimeline(page)).marks === 2);
      await openCaptions(page);
      await waitFor('episode tracks replace the upload', async () => {
        const items = (await readUi(page)).items;
        return items.some((item) => item.includes('عربي')) && items.every((item) => !item.includes('Upload track'));
      });
      await hoverScrubber(page, 0.12);
      await waitFor('intro label', async () => (await readTimeline(page)).chapter === 'Intro');
      assert.equal((await readTimeline(page)).heatmap, false);
      assert.equal(hits.some((hit) => hit.url.includes('/playurl')), false);

      await page.evaluate((path) => {
        const video = document.querySelector('video');
        const view = window as FixtureWindow;
        const aid = path.split('/').pop();
        history.pushState({}, '', path);
        view.__initialState = {
          global: { sLocale: 'en' },
          ogv: { epId: '', season: null, sectionsList: [] },
          ugc: { aid, archive: { aid, title: 'Uploaded special' } }
        };
        video?.dispatchEvent(new Event('timeupdate'));
      }, UGC_PATH);
      await waitFor('upload title returns', async () => (await readUi(page)).title === UGC_TITLE);
      await waitFor('intro marks leave the upload', async () => (await readTimeline(page)).marks === 0);
      const back = await hostLayers(page);
      assert.equal(back.kind, 'ugc');
      assert.equal(back.episode, UGC_AID);
      await hoverScrubber(page, 0.12);
      await waitFor('no intro label on the upload', async () => (await readTimeline(page)).chapter === '');
    } finally {
      await context.close();
      rmSync(userData, { recursive: true, force: true });
    }
  });
});
