export const PAGE_URL = 'https://v.qq.com/x/cover/mzc00200803dr6b/c4102g9a01t.html';
export const FRAME_URL = 'https://vm.gtimg.cn/thumbplayer/txv/wasm/1.0.53/fake-video-element-iframe.html';
export const VIDEO_PAGE = 'https://example.com/plain-video.html';

export const PLAYER_HTML = `<!doctype html>
<html>
<body>
  <div class="txp_player">
    <div class="txp-layer" id="chrome">tencent chrome</div>
    <div class="txp_controls">
      <button class="txp_btn txp_btn_next_u" id="next">next</button>
    </div>
    <div class="txp_videos_container">
      <video id="empty" width="320" height="180"></video>
      <fake-iframe-video id="player" style="display:block;width:800px;height:450px"></fake-iframe-video>
    </div>
  </div>
  <script>
    class FakeIframeVideo extends HTMLElement {
      constructor() {
        super();
        this._paused = false;
        this._time = 10;
        this._duration = 120;
        this._volume = 1;
        this._muted = false;
        this._rate = 1;
        this._ready = 4;
        this._seeking = false;
        this._ended = false;
        this.playCalls = 0;
        this.pauseCalls = 0;
        this.seekSets = [];
        const shadow = this.attachShadow({ mode: 'open' });
        const frame = document.createElement('iframe');
        frame.src = ${JSON.stringify(FRAME_URL)};
        frame.style.cssText = 'width:100%;height:100%;border:0';
        shadow.appendChild(frame);
      }
      play() {
        this.playCalls += 1;
        this._paused = false;
        this.dispatchEvent(new Event('play'));
        return Promise.resolve();
      }
      pause() {
        this.pauseCalls += 1;
        this._paused = true;
        this.dispatchEvent(new Event('pause'));
      }
      get paused() { return this._paused; }
      get ended() { return this._ended; }
      get seeking() { return this._seeking; }
      get currentTime() { return this._time; }
      set currentTime(value) {
        this.seekSets.push(value);
        this._time = value;
        this._seeking = true;
        this.dispatchEvent(new Event('seeking'));
      }
      get duration() { return this._duration; }
      get volume() { return this._volume; }
      set volume(value) { this._volume = value; this.dispatchEvent(new Event('volumechange')); }
      get muted() { return this._muted; }
      set muted(value) { this._muted = value; this.dispatchEvent(new Event('volumechange')); }
      get playbackRate() { return this._rate; }
      set playbackRate(value) { this._rate = value; this.dispatchEvent(new Event('ratechange')); }
      get readyState() { return this._ready; }
      get buffered() { return { length: 1, start: () => 0, end: () => this._time }; }
      supportPictureInPicture() { return false; }
      requestPictureInPicture() { return Promise.resolve(); }
    }
    if (!customElements.get('fake-iframe-video')) customElements.define('fake-iframe-video', FakeIframeVideo);
    window.__counts = (id) => {
      const el = document.getElementById(id);
      return { play: el.playCalls, pause: el.pauseCalls, seeks: el.seekSets.slice() };
    };
  </script>
</body>
</html>`;

export const FRAME_HTML = `<!doctype html><html><body><video id="inner-empty"></video></body></html>`;
export const PLAIN_HTML = `<!doctype html><html><body><video id="plain" src="https://example.com/clip.mp4" width="640" height="360" style="width:640px;height:360px"></video></body></html>`;
