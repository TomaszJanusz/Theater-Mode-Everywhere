import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  disneyAudioPlayId,
  disneyAudioTracks,
  parseDisneyAudioResult,
  parseDisneyAudioSelect,
  parseDisneyAudioSnapshot,
  type DisneyAudioRecord,
  type DisneyAudioResult,
  type DisneyAudioSnapshot
} from './audio-bridge';
import { DISNEY_AUDIO_CHECK_MS, DISNEY_RESUME_GRACE_MS, createDisneyAudioHost } from './audio-main';

const PLAY = 'd1f7a6c2-3b4e-4f5a-9c8d-7e6f5a4b3c2d';
const NEXT = 'a0b1c2d3-e4f5-4a6b-8c7d-9e0f1a2b3c4d';
const href = (id: string) => `https://www.disneyplus.com/pl-pl/play/${id}`;

/** Track objects in the shape read from Hive on a film with 23 tracks (an excerpt). */
function hiveTracks() {
  const track = (id: number, name: string, language: string, title: string, describes = false) =>
    ({ id, name, language, hasDescribesVideo: describes, hasDialogueEnhancement: false, isSelected: false, displayName: { title } });
  return [
    track(1, 'English', 'en', 'English'),
    track(14, 'Polish', 'pl', 'Polski'),
    track(7, 'Spanish', 'es-419', 'Español (Latinoamérica)'),
    track(8, 'Spanish', 'es-ES', 'Español (España)'),
    track(21, 'English', 'en', 'English', true)
  ];
}

/** A `disney-web-player` with its expandos, a Redux-like store, and a manual clock. */
function setup() {
  let now = 0;
  let nextTimer = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const tracks: Array<Record<string, unknown>> = hiveTracks();
  let selected: Record<string, unknown> | null = tracks[0];
  const setTrackCalls: unknown[] = [];
  let pauses = 0;
  let state = { player: { extensions: { audio: { tracks } } } };
  const storeListeners = new Set<() => void>();
  /** Getters that throw for a while, as Hive's can while its pipeline reattaches. */
  const faults = { tracks: false, selected: false };
  const audio = {
    get availableTracks() { if (faults.tracks) throw new Error('reattaching'); return tracks; },
    get selectedTrack() { if (faults.selected) throw new Error('reattaching'); return selected; },
    setTrack(track: unknown) { setTrackCalls.push(track); }
  };
  const player = { audio, pause() { pauses += 1; } };
  const store = {
    getState: () => state,
    subscribe(listener: () => void) { storeListeners.add(listener); return () => { storeListeners.delete(listener); }; }
  };
  let web: Record<string, unknown> | null = { mediaPlayer: player, stateStore: store };
  const env = {
    enabled: true,
    href: href(PLAY),
    contentPaused: true as boolean | null,
    snapshot: null as DisneyAudioSnapshot | null,
    answers: [] as DisneyAudioResult[],
    changes: 0
  };
  const host = createDisneyAudioHost({
    enabled: () => env.enabled,
    href: () => env.href,
    webPlayer: () => web,
    contentPaused: () => env.contentPaused,
    publishSnapshot: payload => { env.snapshot = payload; },
    answer: result => { env.answers.push(result); },
    changed: () => { env.changes += 1; },
    now: () => now,
    setTimeout: (run, ms) => { const id = nextTimer++; timers.set(id, { at: now + ms, run }); return id; },
    clearTimeout: id => { timers.delete(id); }
  });
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].run();
    }
    now = end;
  };
  /** Hive applying a selection, as its store does after the media reload. */
  const hostSelects = (id: number) => {
    selected = tracks.find(track => track.id === id) ?? null;
    state = { player: { extensions: { audio: { tracks } } } };
    for (const listener of [...storeListeners]) listener();
  };
  const query = (requestId = `r${now}`) => {
    host.query(requestId);
    return env.snapshot && parseDisneyAudioSnapshot(JSON.stringify(env.snapshot), requestId, env.href);
  };
  const select = (trackId: string, options: { playId?: string; keepPaused?: boolean; requestId?: string } = {}) =>
    host.select(JSON.stringify({ requestId: options.requestId ?? `s${trackId}`, playId: options.playId ?? PLAY, trackId, keepPaused: options.keepPaused ?? false }));
  const lease = (on: boolean, watchId = 'w1') => host.watch(JSON.stringify({ watchId, on }));
  /** A media reload, ending with Hive reporting `id` when given. */
  const reload = (id?: number) => {
    host.media('emptied', null);
    host.media('loadstart', null);
    if (id !== undefined) hostSelects(id);
    host.media('loadedmetadata', null);
  };
  return {
    host, env, tracks, setTrackCalls, advance, hostSelects, query, select, lease, reload, faults, store, storeListeners, player,
    pauses: () => pauses,
    replaceWeb: (next: Record<string, unknown> | null) => { web = next; },
    web: () => web,
    pendingTimers: () => timers.size
  };
}

const record = (overrides: Partial<DisneyAudioRecord>): DisneyAudioRecord =>
  ({ id: '1', label: 'English', language: 'en', description: false, selected: false, ...overrides });

describe('Disney+ audio bridge', () => {
  it('maps tracks with the endonym, a BCP-47 tag, description and no guessed original', () => {
    assert.deepEqual(disneyAudioTracks([
      record({ id: '1', selected: true }),
      record({ id: '14', label: 'Polski', language: 'pl' }),
      record({ id: '7', label: 'Español (Latinoamérica)', language: 'es-419' }),
      record({ id: '21', description: true }),
      record({ id: '30', label: 'Deutsch – Audiodeskription', language: 'de', description: true }),
      record({ id: '40', label: '', language: 'xx-invalid-tag-that-is-way-too-long-for-bcp47' })
    ]), [
      { id: '1', languageTag: 'en', label: 'English', kind: 'unknown', selected: true },
      { id: '14', languageTag: 'pl', label: 'Polski', kind: 'unknown', selected: false },
      { id: '7', languageTag: 'es-419', label: 'Español (Latinoamérica)', kind: 'unknown', selected: false },
      // Same label as the regular English track: the menu names it from its kind instead.
      { id: '21', languageTag: 'en', label: '', kind: 'description', selected: false },
      { id: '30', languageTag: 'de', label: 'Deutsch – Audiodeskription', kind: 'description', selected: false },
      { id: '40', languageTag: '', label: '', kind: 'unknown', selected: false }
    ]);
  });

  it('keeps two tracks of one language apart and drops ids the host repeats', () => {
    const tracks = disneyAudioTracks([
      record({ id: '7', label: 'Español (Latinoamérica)', language: 'es-419' }),
      record({ id: '8', label: 'Español (España)', language: 'es-ES' }),
      record({ id: '9', label: 'A' }),
      record({ id: '9', label: 'B' })
    ]);
    assert.deepEqual(tracks.map(track => [track.id, track.languageTag]), [['7', 'es-419'], ['8', 'es-ES']]);
  });

  it('accepts a snapshot only for its request, its page and bounded, well-formed tracks', () => {
    const good = { requestId: 'r1', pageHref: href(PLAY), playId: PLAY, tracks: [record({})] };
    const parse = (value: unknown, requestId = 'r1', page = href(PLAY)) => parseDisneyAudioSnapshot(JSON.stringify(value), requestId, page);
    assert.deepEqual(parse(good), good);
    assert.equal(parse(good, 'r2'), null, 'an answer to another query');
    assert.equal(parse(good, 'r1', href(NEXT)), null, 'an answer for another page');
    assert.equal(parse({ ...good, playId: 'not-a-uuid' }), null);
    assert.equal(parse({ ...good, tracks: [record({ id: '<script>' })] }), null);
    assert.equal(parse({ ...good, tracks: [{ ...record({}), description: 'yes' }] }), null);
    assert.equal(parse({ ...good, tracks: [record({ label: 'x'.repeat(201) })] }), null);
    assert.equal(parse({ ...good, tracks: Array.from({ length: 65 }, (_, index) => record({ id: String(index) })) }), null);
    assert.equal(parseDisneyAudioSnapshot('{', 'r1', href(PLAY)), null);
    assert.equal(parseDisneyAudioSnapshot(null, 'r1', href(PLAY)), null);
    assert.equal(parseDisneyAudioSnapshot('x'.repeat(30_001), 'r1', href(PLAY)), null);
  });

  it('validates selection requests and answers as JSON strings', () => {
    const request = { requestId: 'r1', playId: PLAY, trackId: '14', keepPaused: true };
    assert.deepEqual(parseDisneyAudioSelect(JSON.stringify(request)), request);
    assert.equal(parseDisneyAudioSelect(request), null, 'objects do not cross worlds in Firefox');
    assert.equal(parseDisneyAudioSelect(JSON.stringify({ ...request, keepPaused: 'no' })), null);
    assert.equal(parseDisneyAudioSelect(JSON.stringify({ ...request, trackId: '' })), null);
    assert.equal(parseDisneyAudioSelect(JSON.stringify({ ...request, playId: PLAY.toUpperCase() })), null);
    assert.deepEqual(parseDisneyAudioResult('{"requestId":"r1","ok":true}'), { requestId: 'r1', ok: true });
    assert.equal(parseDisneyAudioResult('{"requestId":"r1","ok":1}'), null);
  });

  it('keys the item by the play route, with or without a locale', () => {
    assert.equal(disneyAudioPlayId(href(PLAY.toUpperCase())), PLAY);
    assert.equal(disneyAudioPlayId(`https://www.disneyplus.com/play/${PLAY}?x=1`), PLAY);
    assert.equal(disneyAudioPlayId('https://www.disneyplus.com/browse/entity-123'), null);
    assert.equal(disneyAudioPlayId('not a url'), null);
  });
});

describe('Disney+ audio in MAIN', () => {
  it('lists the live tracks with the selection read from selectedTrack', () => {
    const { query } = setup();
    const snapshot = query();
    assert.equal(snapshot?.playId, PLAY);
    assert.deepEqual(snapshot?.tracks.map(track => [track.id, track.label, track.language, track.description, track.selected]), [
      ['1', 'English', 'en', false, true], ['14', 'Polski', 'pl', false, false], ['7', 'Español (Latinoamérica)', 'es-419', false, false],
      ['8', 'Español (España)', 'es-ES', false, false], ['21', 'English', 'en', true, false]
    ]);
  });

  it('answers nothing for a missing, malformed or throwing player, another route or RTE off', () => {
    const cases: Array<[string, (context: ReturnType<typeof setup>) => void]> = [
      ['no player element', context => context.replaceWeb(null)],
      ['mediaPlayer not an own expando', context => context.replaceWeb(Object.create({ mediaPlayer: context.player }))],
      ['no audio API', context => context.replaceWeb({ mediaPlayer: { audio: { availableTracks: [] } } })],
      ['getter throws', context => context.replaceWeb({ mediaPlayer: { audio: { get availableTracks() { throw new Error('attaching'); }, setTrack() {} } } })],
      ['not a play route', context => { context.env.href = 'https://www.disneyplus.com/home'; }],
      ['integration off', context => { context.env.enabled = false; }]
    ];
    for (const [name, arrange] of cases) {
      const context = setup();
      arrange(context);
      assert.equal(context.query(), null, name);
      context.select('14');
      assert.deepEqual(context.env.answers.map(answer => answer.ok), [false], name);
      assert.equal(context.setTrackCalls.length, 0, name);
    }
    const empty = setup();
    empty.replaceWeb({ mediaPlayer: { audio: { availableTracks: undefined, selectedTrack: null, setTrack() {} } } });
    assert.deepEqual(empty.query()?.tracks, [], 'tracks not set yet: an empty list, not an error');
  });

  it('does not let a player carried over from the previous title describe the next until it reloads', () => {
    const { env, host, query } = setup();
    assert.ok(query());
    env.href = href(NEXT);
    assert.equal(query(), null, 'same Hive object, new route, old media');
    host.media('emptied', null);
    host.media('loadedmetadata', null);
    assert.equal(query()?.playId, NEXT);
  });

  it('selects the live track object and confirms once a reload after the pick ends with Hive reporting it', () => {
    const { env, tracks, setTrackCalls, advance, hostSelects, select, reload, host, pendingTimers } = setup();
    select('14');
    assert.equal(setTrackCalls.length, 1);
    assert.equal(setTrackCalls[0], tracks[1], 'the object from availableTracks, not a copy');
    advance(DISNEY_AUDIO_CHECK_MS * 2);
    assert.deepEqual(env.answers, [], 'nothing until selectedTrack moves');
    hostSelects(14);
    advance(DISNEY_AUDIO_CHECK_MS * 2);
    assert.deepEqual(env.answers, [], 'a selection without the reload that carries it is not yet the switch');
    host.media('emptied', null);
    advance(DISNEY_AUDIO_CHECK_MS);
    assert.deepEqual(env.answers, [], 'nor while the media reloads');
    reload();
    assert.deepEqual(env.answers, [{ requestId: 's14', ok: true }]);
    assert.equal(pendingTimers(), 1, 'command timers released with the answer; the playback grace remains');
    advance(DISNEY_RESUME_GRACE_MS);
    assert.equal(pendingTimers(), 0, 'and ends on its own');
  });

  it('accepts at the deadline a selection Hive made without a reload, and refuses one it did not make', () => {
    const quiet = setup();
    quiet.select('14');
    quiet.hostSelects(14);
    quiet.advance(8_000);
    assert.deepEqual(quiet.env.answers, [{ requestId: 's14', ok: true }]);
    const reloading = setup();
    reloading.select('14');
    reloading.hostSelects(14);
    reloading.host.media('emptied', null);
    reloading.advance(8_000);
    assert.deepEqual(reloading.env.answers, [{ requestId: 's14', ok: false }], 'a reload still under way at the deadline settles nothing');
  });

  it('answers at once for the track already playing, and refuses one no longer offered', () => {
    const { env, setTrackCalls, select } = setup();
    select('1');
    select('99');
    select('14', { playId: NEXT });
    assert.deepEqual(env.answers.map(answer => answer.ok), [true, false, false]);
    assert.equal(setTrackCalls.length, 0);
  });

  it('lets the last of fast picks win and refuses the ones it replaced', () => {
    const { env, setTrackCalls, advance, hostSelects, select, host } = setup();
    host.media('emptied', null);
    select('14');
    advance(300);
    select('7');
    assert.deepEqual(env.answers, [{ requestId: 's14', ok: false }]);
    assert.equal(setTrackCalls.length, 2, 'Hive applies the second call at the end of its debounce');
    // The first pick's reload lands while the trailing call is still pending.
    hostSelects(14);
    host.media('loadedmetadata', null);
    advance(800);
    assert.equal(env.answers.length, 1, 'Polish is not the newest pick');
    host.media('emptied', null);
    hostSelects(7);
    advance(DISNEY_AUDIO_CHECK_MS);
    assert.equal(env.answers.length, 1, 'no answer while the media still reloads');
    host.media('loadedmetadata', null);
    assert.deepEqual(env.answers.at(-1), { requestId: 's7', ok: true });
  });

  it('does not confirm a return to the playing track before the reloads Hive still owes have run', () => {
    const { env, setTrackCalls, advance, select, reload } = setup();
    select('14');
    advance(100);
    select('1');
    assert.equal(setTrackCalls.length, 2, 'English must be sent again: Polish is already on its way');
    // The leading call's reload starts only at 1.2 s; English shows as selected, debounced or not.
    advance(1_100);
    assert.deepEqual(env.answers, [{ requestId: 's14', ok: false }], 'English is not acknowledged before Polish has played');
    reload(14);
    advance(DISNEY_AUDIO_CHECK_MS);
    assert.equal(env.answers.length, 1, 'Polish is not the newest pick');
    reload(1);
    assert.deepEqual(env.answers.at(-1), { requestId: 's1', ok: true });
  });

  it('refuses after the timeout, and when the title, player or integration changes mid-command', () => {
    const timeout = setup();
    timeout.select('14');
    timeout.advance(8_000);
    assert.deepEqual(timeout.env.answers, [{ requestId: 's14', ok: false }]);

    const changes: Array<[string, (context: ReturnType<typeof setup>) => void]> = [
      ['next title', context => { context.env.href = href(NEXT); }],
      ['player replaced', context => context.replaceWeb({ ...context.web(), mediaPlayer: { audio: { availableTracks: context.tracks, selectedTrack: context.tracks[1], setTrack() {} } } })],
      ['RTE off', context => { context.env.enabled = false; }],
      ['track withdrawn', context => { context.tracks.splice(1, 1); }]
    ];
    for (const [name, change] of changes) {
      const context = setup();
      context.select('14');
      change(context);
      context.hostSelects(14);
      context.advance(DISNEY_AUDIO_CHECK_MS * 3);
      assert.deepEqual(context.env.answers.map(answer => answer.ok), [false], name);
    }
  });

  it('puts back a pause the viewer chose when the reload resumes playback, once', () => {
    const { host, advance, hostSelects, select, pauses } = setup();
    select('14', { keepPaused: true });
    host.media('playing', null);
    assert.equal(pauses(), 0, 'a play before the reload is not the reload\'s');
    host.media('emptied', null);
    host.media('loadstart', null);
    hostSelects(14);
    host.media('loadedmetadata', null);
    advance(DISNEY_AUDIO_CHECK_MS);
    host.media('playing', null);
    assert.equal(pauses(), 1, 'Hive pause, so its own state is paused too');
    host.media('playing', null);
    assert.equal(pauses(), 1, 'a later play is the viewer\'s');
  });

  it('leaves playback alone when the title was playing, the viewer started it, or the grace ran out', () => {
    const playing = setup();
    playing.select('14');
    playing.host.media('emptied', null);
    playing.host.media('playing', null);
    assert.equal(playing.pauses(), 0);

    const started = setup();
    started.select('14', { keepPaused: true });
    started.host.media('emptied', null);
    started.env.contentPaused = true;
    started.host.playbackToggled();
    started.host.media('playing', null);
    assert.equal(started.pauses(), 0, 'Play pressed in theater during the switch');

    const pausing = setup();
    pausing.select('14', { keepPaused: true });
    pausing.host.media('emptied', null);
    pausing.env.contentPaused = false;
    pausing.host.playbackToggled();
    pausing.host.media('playing', null);
    assert.equal(pausing.pauses(), 1, 'a Pause press does not cancel putting the pause back');

    const late = setup();
    late.select('14', { keepPaused: true });
    late.reload(14);
    assert.deepEqual(late.env.answers.map(answer => answer.ok), [true]);
    late.host.media('emptied', null);
    late.advance(DISNEY_RESUME_GRACE_MS);
    late.host.media('playing', null);
    assert.equal(late.pauses(), 0);

    const moved = setup();
    moved.select('14', { keepPaused: true });
    moved.host.media('emptied', null);
    moved.env.href = href(NEXT);
    moved.host.media('playing', null);
    assert.equal(moved.pauses(), 0, 'never pauses another title');
  });

  it('keeps a Pause pressed during a switch started from playback, and pauses after every reload it owes', () => {
    const paused = setup();
    paused.select('14');
    paused.env.contentPaused = false;
    paused.host.playbackToggled();
    paused.reload(14);
    paused.host.media('playing', null);
    assert.equal(paused.pauses(), 1, 'Pause pressed before the reload resumed playback');

    const playing = setup();
    playing.select('14');
    playing.reload(14);
    playing.host.media('playing', null);
    assert.equal(playing.pauses(), 0, 'content the viewer plays is never paused');

    const twice = setup();
    twice.select('14', { keepPaused: true });
    twice.advance(100);
    // The second pick happens during the first reload, when the element has no playback history to read.
    twice.select('7');
    twice.reload(14);
    twice.host.media('playing', null);
    twice.reload(7);
    twice.host.media('playing', null);
    assert.equal(twice.pauses(), 2, 'the pause chosen before the first pick holds through both reloads');
  });

  it('keeps checking through Hive getters that throw while the switch runs', () => {
    for (const fault of ['tracks', 'selected'] as const) {
      const context = setup();
      context.select('14');
      context.faults[fault] = true;
      context.host.media('emptied', null);
      context.advance(DISNEY_AUDIO_CHECK_MS * 3);
      assert.deepEqual(context.env.answers, [], `${fault}: a throwing read is not an answer`);
      assert.ok(context.pendingTimers() > 0, `${fault}: the next check is still scheduled`);
      context.hostSelects(14);
      context.host.media('loadedmetadata', null);
      context.advance(DISNEY_AUDIO_CHECK_MS);
      assert.deepEqual(context.env.answers, [], `${fault}: still unreadable, still waiting`);
      context.faults[fault] = false;
      context.advance(DISNEY_AUDIO_CHECK_MS);
      assert.deepEqual(context.env.answers, [{ requestId: 's14', ok: true }], fault);
    }
  });

  it('follows the state store only while leased, ignoring dispatches that change no audio', () => {
    const { env, lease, storeListeners, hostSelects } = setup();
    assert.equal(storeListeners.size, 0, 'no subscription without a theater adapter');
    lease(true);
    lease(true, 'w2');
    assert.equal(storeListeners.size, 1);
    for (const listener of [...storeListeners]) listener();
    assert.equal(env.changes, 0, 'a playback tick leaves the audio slice alone');
    hostSelects(14);
    assert.equal(env.changes, 1);
    lease(false);
    assert.equal(storeListeners.size, 1, 'another adapter still watches');
    lease(false, 'w2');
    assert.equal(storeListeners.size, 0);
    lease(false, 'w2');
    assert.equal(storeListeners.size, 0, 'releasing twice is harmless');
  });

  it('drops pending work, but not Hive\'s switch, when the last lease ends', () => {
    const { env, lease, select, host, setTrackCalls, pendingTimers, pauses } = setup();
    lease(true);
    select('14', { keepPaused: true });
    host.media('emptied', null);
    lease(false);
    assert.deepEqual(env.answers, [{ requestId: 's14', ok: false }]);
    assert.equal(pendingTimers(), 0);
    host.media('playing', null);
    assert.equal(pauses(), 0, 'nothing is restored after exit');
    assert.equal(setTrackCalls.length, 1, 'the choice is not undone');
    host.dispose();
    host.dispose();
  });
});
