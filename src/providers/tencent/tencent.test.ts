import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { captureTencentJsonpScript, harvestTencentBody, readTencentSnapshot, tencentContentTitle, tencentPageVideoId } from './main';
import { normalizeTencentMetadata, parseTencentCaptions, parseTencentStoryboard, tencentCaptionUrl, tencentPreviewFrame } from '../../media-features/parsers/tencent';
import { classifyMediaFetchUrl, isAllowedMediaFetchUrl, assertSafeRedirect } from '../../media-features/fetch-allowlist';
import { TencentAdapter } from './adapter';
import { createWorldMessage, type WorldEnvelope } from '../../protocol/world-messages';

const videoId = 'h0045v8ky1m';
// Reduced getvinfo field structure observed on Three-Body EP1. No account or stream data.
const subtitle = { id: 53103, name: 'English', lang: 'EN', captionType: 3, keyid: `${videoId}.53103`,
  url: 'https://cffaws.wetvinfo.com/svp_50125/example.f715103.vtt.m3u8' };
const preview = { cd: 10, h: 90, w: 160, r: 5, c: 5, fn: 'q2', url: 'http://video-caps.wetvinfo.com/0/' };
function metadata(id = videoId) {
  return { em: 0, sfl: { fi: [{ ...subtitle, keyid: `${id}.53103` }] },
    vl: { vi: [{ vid: id, ti: 'EP1: Three-Body', td: '2564', lnk: id, pl: [{ pd: [preview] }] }] } };
}

function installPage() {
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  const attrs = new Set<string>();
  const win = Object.assign(new EventTarget(), {
    location: { hostname: 'wetv.vip', pathname: `/en/play/cover/${videoId}-EP1`, origin: 'https://wetv.vip' },
    setTimeout, clearTimeout
  });
  globalThis.window = win as any;
  globalThis.document = { title: 'Three-Body EP1 Watch Free with Eng Sub | WeTV',
    documentElement: { hasAttribute: (key: string) => attrs.has(key), toggleAttribute: (key: string, on: boolean) => { if (on) attrs.add(key); else attrs.delete(key); } } } as any;
  return { win, attrs, restore() { globalThis.window = oldWindow; globalThis.document = oldDocument; } };
}

describe('Tencent RTE', () => {
  it('cleans domestic marketing and WeTV suffixes', () => {
    assert.equal(tencentContentTitle('兰香如故_01_电视剧_高清完整版视频在线观看_腾讯视频'), '兰香如故_01');
    assert.equal(tencentContentTitle('腾讯视频'), null);
    assert.equal(tencentContentTitle('Three-Body EP1 Watch Free with Eng Sub | WeTV'), 'Three-Body EP1');
  });

  it('distinguishes video IDs from series IDs and supports embedded players', () => {
    const page = installPage();
    try {
      page.win.location.pathname = '/x/cover/mzc00200803dr6b.html';
      (page.win as any).VIDEO_INFO = { vid: videoId };
      assert.equal(tencentPageVideoId(), videoId);
      page.win.location.pathname = '/txp/iframe/player.html';
      (page.win.location as any).search = '?vid=x0045o8w903';
      assert.equal(tencentPageVideoId(), 'x0045o8w903');
    } finally { page.restore(); }
  });

  it('normalizes VTT wrapper URLs and imports only accessible SRT/VTT tracks for the current video', () => {
    const tracks = parseTencentCaptions([subtitle, subtitle, { ...subtitle, id: 2, lmt: 1 },
      { ...subtitle, id: 3, captionType: 2 }, { ...subtitle, id: 4, keyid: 'x0045o8w903.53103' },
      { ...subtitle, id: 5, url: 'https://evil.test/track.vtt', urlList: { ui: [{ url: 'https://subtitle.tc.qq.com/track.vtt' }] } }], videoId);
    assert.equal(tracks.length, 2);
    assert.equal(tracks[0].url, 'https://cffaws.wetvinfo.com/svp_50125/example.f715103.vtt');
    assert.equal(tracks[0].language, 'en');
    assert.equal(tracks[1].url, 'https://subtitle.tc.qq.com/track.vtt');
    assert.equal(tencentCaptionUrl('http://subtitle.tc.qq.com/track.srt', 1), 'https://subtitle.tc.qq.com/track.srt');
  });

  it('restricts caption requests and redirects to the observed subtitle hosts and file types', () => {
    const url = 'https://subtitle.wetvinfo.com/track.vtt?auth_key=signed';
    assert.deepEqual(classifyMediaFetchUrl(url), { provider: 'tencent', kind: 'caption-track', url });
    for (const bad of ['http://subtitle.tc.qq.com/a.vtt', 'https://subtitle.tc.qq.com.evil.test/a.vtt',
      'https://user@subtitle.tc.qq.com/a.vtt', 'https://subtitle.tc.qq.com:444/a.vtt',
      'https://play.wetv.vip/getvinfo', 'https://cffaws.wetvinfo.com/video.m3u8']) {
      assert.equal(isAllowedMediaFetchUrl({ provider: 'tencent', kind: 'caption-track', url: bad }), false);
      assert.equal(assertSafeRedirect(bad, { provider: 'tencent', kind: 'caption-track', url }), false);
    }
  });

  it('selects the 160px sprite and handles rows, sheets and the end of the video', () => {
    const shot = parseTencentStoryboard([{ ...preview, w: 80, fn: 'q1', r: 10, c: 10 }, preview], videoId, 2564)!;
    assert.equal(shot.width, 160);
    assert.equal(shot.baseUrl, 'https://video-caps.wetvinfo.com/0/');
    assert.equal(tencentPreviewFrame(shot, 50)?.image.y, 90);
    const frame = tencentPreviewFrame(shot, 260)!;
    assert.equal(frame.image.url, `https://video-caps.wetvinfo.com/0/${videoId}.q2.2.jpg/0`);
    assert.equal(frame.image.x, 160);
    assert.equal(frame.image.y, 0);
    assert.equal(tencentPreviewFrame(shot, 9999)?.time, 2560);
    assert.equal(tencentPreviewFrame(shot, -5)?.time, 0);
    assert.equal(tencentPreviewFrame(shot, NaN), null);
    for (const partial of [{ c: 0 }, { cd: Infinity }, { fn: '../q2' }, { url: 'https://evil.test/0/' }]) {
      assert.equal(parseTencentStoryboard([{ ...preview, ...partial }], videoId, 2564), null);
    }
  });

  it('rejects error responses and metadata for another episode and excludes account/stream fields', () => {
    assert.equal(normalizeTencentMetadata(metadata(), 'x0045o8w903'), null);
    assert.equal(normalizeTencentMetadata({ ...metadata(), em: 80 }, videoId), null);
    const snapshot = normalizeTencentMetadata({ ...metadata(), login: { token: 'private' }, ip: 'private' }, videoId)!;
    assert.equal(snapshot.captionTracks.length, 1);
    assert.ok(snapshot.storyboard);
    assert.equal(JSON.stringify(snapshot).includes('private'), false);
  });

  it('harvests JSONP without evaluating code, honors RTE-off and discards the previous episode', () => {
    const page = installPage();
    try {
      const url = 'https://play.wetv.vip/getvinfo?callback=getinfo_callback_42';
      harvestTencentBody(url, `getinfo_callback_42(${JSON.stringify(metadata())});`);
      assert.equal(readTencentSnapshot()?.captionTracks.length, 1);
      page.win.location.pathname = '/en/play/cover/x0045o8w903-EP2';
      harvestTencentBody(url, `getinfo_callback_42(${JSON.stringify(metadata())});`);
      assert.deepEqual(readTencentSnapshot()?.captionTracks, []);
      harvestTencentBody('https://evil.test/getvinfo', JSON.stringify(metadata('x0045o8w903')));
      harvestTencentBody(url, `getinfo_callback_42(${JSON.stringify(metadata('x0045o8w903'))});globalThis.injected=true;`);
      assert.deepEqual(readTencentSnapshot()?.captionTracks, []);
      page.attrs.add('data-te-tencent-integration-off');
      assert.equal(readTencentSnapshot(), null);
      page.attrs.clear();
      page.win.location.hostname = 'news.qq.com';
      assert.equal(readTencentSnapshot(), null);
    } finally { page.restore(); }
  });

  it('wraps only Tencent getinfo callbacks and preserves their receiver, arguments and return value', () => {
    const page = installPage();
    try {
      const receiver = {};
      let calls = 0;
      (page.win as any).getinfo_callback_42 = function(this: unknown, data: unknown, second: string) {
        assert.equal(this, receiver); assert.equal(second, 'second'); calls++; return data;
      };
      const url = 'https://play.wetv.vip/getvinfo?callback=getinfo_callback_42';
      captureTencentJsonpScript(url); captureTencentJsonpScript(url);
      const value = metadata();
      assert.equal((page.win as any).getinfo_callback_42.call(receiver, value, 'second'), value);
      assert.equal(calls, 1);
      assert.equal(readTencentSnapshot()?.captionTracks.length, 1);
      const other = () => undefined;
      (page.win as any).other = other;
      captureTencentJsonpScript('https://play.wetv.vip/getvinfo?callback=other');
      assert.equal((page.win as any).other, other);
    } finally { page.attrs.add('data-te-tencent-integration-off'); readTencentSnapshot(); page.restore(); }
  });

  it('reads existing WeTV player metadata after startup and rejects a stale player after navigation', () => {
    const page = installPage();
    try {
      const video = metadata().vl.vi[0];
      (page.win as any).player = { vid: videoId, getApiBridge: () => ({ videoInfo: { parseData: {
        vitem: video, title: video.ti, duration: video.td, subtitleList: [subtitle], previewList: [preview]
      } } }) };
      assert.equal(readTencentSnapshot()?.captionTracks.length, 1);
      assert.equal(readTencentSnapshot()?.title, 'EP1: Three-Body');
      page.win.location.pathname = '/en/play/cover/x0045o8w903-EP2';
      assert.deepEqual(readTencentSnapshot()?.captionTracks, []);
    } finally { page.restore(); }
  });

  it('renders imported VTT, hides host captions reversibly and rejects late caption loads', async () => {
    const page = installPage();
    const snapshot = normalizeTencentMetadata(metadata(), videoId)!;
    const body = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHello &amp; welcome\n';
    const replies: Array<() => void> = [];
    let delay = false;
    page.win.addEventListener('theater-everywhere-media-probe', (event) => {
      const requestId = (event as CustomEvent).detail.requestId;
      page.win.dispatchEvent(new CustomEvent('theater-everywhere-media-probe-result', { detail: { requestId, tencent: snapshot } }));
    });
    (page.win as any).postMessage = (request: WorldEnvelope) => {
      const send = () => page.win.dispatchEvent(Object.assign(new Event('message'), { source: page.win,
        data: createWorldMessage('PAGE_FETCH_RESULT', { ok: true, body }, request.requestId, request.nonce, request.origin) }));
      if (delay) replies.push(send); else send();
    };
    const adapter = new TencentAdapter();
    try {
      assert.deepEqual(await adapter.probe(), { captions: true, chapters: false, previews: true });
      const tracks = await adapter.listCaptionTracks();
      const active = await adapter.activateCaptionTrack(tracks[0].id);
      assert.equal(active.status, 'active');
      assert.equal(active.cues[0].text, 'Hello & welcome');
      assert.equal(page.attrs.has('data-te-tencent-captions-hidden'), true);
      await adapter.activateCaptionTrack(null);
      assert.equal(page.attrs.has('data-te-tencent-captions-hidden'), true);
      delay = true;
      const pending = adapter.activateCaptionTrack(tracks[0].id);
      await Promise.resolve(); await Promise.resolve();
      assert.equal(replies.length, 1);
      adapter.dispose();
      replies[0]();
      assert.equal((await pending).status, 'failed');
      assert.equal(page.attrs.has('data-te-tencent-captions-hidden'), false);
    } finally { adapter.dispose(); page.restore(); }
  });
});
