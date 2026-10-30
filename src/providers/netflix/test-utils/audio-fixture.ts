/** Synthetic Cadmium fixture following the 2026-10-30 real-host API measurements, not a live-host pass. */
export const netflixAudioFixture = `(() => {
  const raw = [
    { trackId: 'A:2:1;2;en;0;0;0;', bcp47: 'en', displayName: 'English [original]', trackType: 'PRIMARY', rawTrackType: 'PRIMARY', isNative: true },
    { trackId: 'A:2:1;2;pl;0;0;0;', bcp47: 'pl', displayName: 'polski', trackType: 'PRIMARY', rawTrackType: 'PRIMARY', isNative: false },
    { trackId: 'A:2:1;2;en;1;0;0;', bcp47: 'en', displayName: 'English — Audio Description', trackType: 'ASSISTIVE', rawTrackType: 'ASSISTIVE', isNative: true },
    { trackId: 'A:2:1;6;pl;0;0;0;', bcp47: 'pl', displayName: 'polski 5.1', trackType: 'PRIMARY', rawTrackType: 'PRIMARY', isNative: false },
    ...['fr-CA', 'fr', 'es-ES', 'es-419', 'pt-BR', 'de', 'ja', 'ko', 'zh-Hant'].map(tag => ({ trackId: 'A:' + tag, bcp47: tag, displayName: tag, trackType: 'PRIMARY', rawTrackType: 'PRIMARY', isNative: false }))
  ].map(track => ({ channels: '2.0', surroundFormatLabel: '2.0', ...track }));
  const sessions = [];
  const create = (movieId, element) => {
    const listeners = new Map();
    const state = { movieId, element, tracks: raw.map(track => ({ ...track })), manifest: true, ad: false, mode: 'sync', sets: [], reads: 0 };
    state.current = state.tracks[0];
    const emit = type => [...listeners.get(type) || []].forEach(fn => fn());
    const choose = track => { state.current = track; emit('audiotrackchanged'); };
    const player = {
      getMovieId: () => state.movieId,
      getElement: () => state.element,
      isReady: () => true,
      getAudioTrackList: () => { state.reads++; if (!state.manifest) throw Error('manifest loading'); return state.tracks; },
      getAudioTrack: () => { if (!state.manifest) throw Error('manifest loading'); return state.current; },
      getAdManager: () => ({ adPresenting: state.ad }),
      getTimedTextTrackList: () => [], getTimedTextTrack: () => null, setTimedTextTrack() {},
      setAudioTrack: track => {
        if (!state.tracks.includes(track)) return Promise.reject(Error('Invalid setAudioTrack call'));
        state.sets.push(track.trackId);
        if (state.mode === 'throw') return Promise.reject(Error('refused'));
        if (state.mode === 'refuse') return Promise.resolve();
        if (state.mode === 'sync') { choose(track); emit('timedtexttracklistchanged'); return Promise.resolve(); }
        state.complete = () => { choose(state.tracks.find(item => item.trackId === track.trackId)); state.resolve?.(); };
        return state.mode === 'pending' ? new Promise(resolve => { state.resolve = resolve; }) : Promise.resolve();
      },
      addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
      removeEventListener: (type, fn) => listeners.get(type)?.delete(fn)
    };
    Object.assign(state, { player, emit, choose, listenerCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0) });
    sessions.push(state);
    return state;
  };
  const video = document.querySelector('.watch-video video');
  const background = create('999999', document.createElement('video'));
  window.nf = create('12345', video);
  window.nfSessions = sessions;
  window.nfCreate = create;
  window.netflix = { appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer: {
    getAllPlayerSessionIds: () => ['preload', 'watch-fixture'],
    getVideoPlayerBySessionId: id => id === 'preload' ? background.player : window.nf.player
  } }) } } } };
})()`;

export const netflixAudioHtml = `<!doctype html><body><div class="watch-video"><div data-uia="player" class="nf-player-container"><video muted style="width:640px;height:360px"></video></div></div><script>${netflixAudioFixture}</script></body>`;
