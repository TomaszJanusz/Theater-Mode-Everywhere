import type { Fixture } from './resource-model';
export function fixtureUrl(fixture: Fixture, origin: string): string {
  if (fixture.startsWith('disney-')) return `https://www.disneyplus.com/${fixture === 'disney-catalog' ? 'browse' : 'play/86e14fdb-3841-4282-ad38-07c8c4aab4b6'}`;
  if (fixture.startsWith('chat-') && fixture !== 'chat-absent') return `https://www.twitch.tv/${fixture === 'chat-replay' ? 'videos/55' : 'example'}`;
  if (fixture.startsWith('youtube-')) return 'https://www.youtube.com/watch?v=abcdefghijk';
  return `${origin}/${fixture}`;
}
export function fixtureDocument(fixture: Fixture, origin: string): string {
  const video = `<video class="hive-video html5-main-video" muted loop playsinline preload="auto" src="/vod.webm"></video>`;
  const chat = fixture === 'chat-replay' ? '<div class="video-chat"><div class="video-chat__message-list-wrapper"></div></div>'
    : '<div class="stream-chat"><section class="chat-room" data-test-selector="chat-room-component-layout"><textarea></textarea></section></div>';
  const main = fixture === 'generic-mousemove' ? `<div id="bulk">${'<div></div>'.repeat(20000)}</div><div id="target"><div><span>hover</span></div></div>`
    : fixture === 'generic-iframes' ? Array.from({ length: 12 }, (_, i) => `<iframe src="${origin}/frame-${i}"></iframe>`).join('')
    : fixture === 'generic-late-shadow' || fixture === 'disney-catalog' ? '<div id="late"></div>'
    : fixture.startsWith('disney-') ? `<disney-web-player><disney-web-player-ui>${video}<timed-text-override-region></timed-text-override-region></disney-web-player-ui></disney-web-player>`
    : fixture.startsWith('chat-') ? `<div class="persistent-player">${video}</div>${fixture === 'chat-absent' ? '' : `<div class="right-column" data-a-target="right-column-chat-bar"${fixture === 'chat-hidden' ? ' hidden' : ''}>${chat}</div>`}`
    : `<ytd-watch-flexy video-id="abcdefghijk"><div id="movie_player">${video}</div></ytd-watch-flexy>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#111}video,.persistent-player,disney-web-player,#movie_player{display:block;width:960px;height:540px}
    .right-column{width:340px;height:420px}.NativeLight{--color-background-base:var(--color-white);--color-background-input:white}
    .NativeDark{--color-background-base:var(--color-hinted-grey-2);--color-background-input:black}
    </style></head><body>${main}</body></html>`;
}
/** Hive public timing/seek API attached via the same discovery shape as the host.
 * The caption region matches stage.test.ts; no proprietary player is simulated. */
export const HIVE_STUB = String.raw`(() => {
  const listeners = new Map(), stats = { playhead: 0, duration: 0, events: 0, seeks: 0, clockEvents: 0, clockMediaId: null }, info = {};
  window.addEventListener('theater-everywhere-disney-clock', event => { stats.clockEvents++; stats.clockMediaId = event.detail.mediaId; });
  let time = 10000;
  Object.defineProperties(info, {
    playheadPositionMs: { get() { stats.playhead++; return time; } },
    durationMs: { get() { stats.duration++; return 120000; } }
  });
  const player = {
    timeline: { info },
    seek(ms) { stats.seeks++; time = ms; this.emit('@EVENT/PLAYER/PLAYBACK/MEDIA_SEEK_COMPLETE'); },
    play() { this.emit('@EVENT/PLAYER/PLAYBACK/MEDIA_RESUMED'); }, pause() {}, scrub() {},
    on(name, callback) { const group = listeners.get(name) || []; group.push(callback); listeners.set(name, group); },
    off(name, callback) { listeners.set(name, (listeners.get(name) || []).filter(c => c !== callback)); },
    emit(name) { for (const callback of listeners.get(name) || []) { stats.events++; callback(); } }
  };
  const host = document.querySelector('disney-web-player');
  if (host) {
    host.__reactFiber$audit = { memoizedProps: { mediaPlayer: player } };
    const region = host.querySelector('timed-text-override-region');
    region.attachShadow({mode:'open'}).innerHTML = '<div class="hive-subtitle-renderer-line">fixture caption</div>';
  }
  window.__hive = { stats, player };
})();`;
