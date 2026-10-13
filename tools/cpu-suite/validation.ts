import { isNeutralAudio, sameAudioSettings } from '../../src/audio-settings';
import { reason, type Measurement, type PlayerSnapshot, type Reason, type Sample, type Scenario, type State } from './model';

export function progress(pre: PlayerSnapshot, post: PlayerSnapshot, wallSec: number, paused: boolean): Reason | null {
  if (!pre.video || !post.video) return reason('missing-video');
  if (pre.videoToken !== post.videoToken || pre.videoToken == null || pre.videoId !== post.videoId) return reason('video-replaced');
  if (pre.video.rate !== 1 || post.video.rate !== pre.video.rate) return reason('playback-rate');
  const advanced = post.video.currentTime - pre.video.currentTime;
  if (paused) return pre.video.paused && post.video.paused && Math.abs(advanced) <= 0.35 ? null : reason('pause-drift');
  if (pre.video.paused || post.video.paused) return reason('playback-paused');
  return advanced + 0.25 >= wallSec * pre.video.rate * 0.9 && advanced <= wallSec * pre.video.rate + 0.5
    ? null : reason('playback-progress', `${advanced.toFixed(3)}s in ${wallSec.toFixed(3)}s`);
}
export function checkState(state: State, player: PlayerSnapshot): Reason | null {
  const video = player.video;
  if (!video) return reason('missing-video');
  if (video.error) return reason('media-error', video.error);
  if (player.ad) return reason('advertisement');
  if (video.muted || video.volume <= 0 || player.nativeVolume !== 100) return reason('inaudible-media');
  if (video.readyState < 3) return reason('not-ready');
  if (video.paused !== state.paused) return reason('pause-state');
  if (player.theater !== state.theater) return reason('theater-state');
  if (!player.focus) return reason('page-focus');
  if (state.extension) {
    if (player.integrationOff === state.rte) return reason('rte-preference');
    if (state.theater && player.rteSignal !== state.rte) return reason('rte-signal');
    if (!video.audio || !sameAudioSettings(video.audio, state.audio) || video.boost !== state.boost) return reason('audio-settings');
    const needsGraph = state.boost > 1 || !isNeutralAudio(state.audio) || state.transition === 'neutralize' || state.transition === 'exit';
    if ((needsGraph || video.graphReady) && (!video.graphReady || !video.graph || video.graph.state !== 'running' || video.graph.gain == null
        || Math.abs(video.graph.gain - state.boost) > 0.001)) return reason('audio-graph');
  }
  if (state.bar === 'focused' && (!player.barVisible || !player.sliderFocused || !player.sliderFocusVisible)) return reason('slider-focus');
  if (state.bar === 'hidden' && (player.barVisible || player.sliderFocused)) return reason('bar-not-hidden');
  if (player.captionsVisible !== state.captions) return reason(state.captions ? 'captions-hidden' : 'captions-visible');
  for (const key of ['stable', 'voice', 'cinematic'] as const) {
    const actual = player.native[key];
    if (actual == null) return reason('native-unavailable', key);
    if (actual !== state.native[key] && !(key === 'stable' && state.allowStableForcedOff && player.native.voice === true && actual === false)) {
      return reason('native-state', `${key}: ${actual}`);
    }
  }
  if (state.native.cinematic && player.native.cinematicChildren < 1) return reason('cinematic-empty');
  return null;
}
export function checkPlayer(scenario: Scenario, player: PlayerSnapshot): Reason | null {
  const stateError = checkState(scenario.expected, player);
  if (stateError) return stateError;
  const v = player.video!, target = scenario.target;
  if (player.videoId !== target.id || new URL(player.href).searchParams.get('v') !== target.id) return reason('video-id');
  if (player.quality !== target.quality || v.width !== target.width || v.height !== target.height) return reason('video-quality');
  if (!player.fmt || !player.afmt) return reason('codec-unavailable');
  if (target.fps != null && player.streamFps !== target.fps) return reason('stream-fps', String(player.streamFps));
  if (player.inner[0] !== 1440 || player.inner[1] !== 900) return reason('viewport');
  return null;
}
export function validateMeasurement(scenario: Scenario, sample: Measurement, threshold: number, windowMs: number): Reason | null {
  if (sample.processSetChanged) return reason('process-set-changed');
  if (sample.counterError) return reason('cpu-counter', sample.counterError);
  for (const key of ['rendererPct', 'threadPct', 'familyPct', 'gpuPct', 'nonChromePct'] as const) {
    const value = sample[key];
    if (value == null || !Number.isFinite(value) || value < 0) return reason('cpu-counter', key);
  }
  if (Math.abs(sample.wallSec - windowMs / 1000) > Math.max(0.25, windowMs / 1000 * 0.075)) return reason('window-length');
  if (sample.nonChromePct! > threshold) return reason('external-load', `${sample.nonChromePct!.toFixed(1)} > ${threshold.toFixed(1)}`);
  for (const player of [sample.pre, sample.post]) {
    const invalid = checkPlayer(scenario, player);
    if (invalid) return invalid;
  }
  if (sample.pre.fmt !== sample.post.fmt || sample.pre.afmt !== sample.post.afmt) return reason('codec-changed');
  if (sample.pre.streamFps !== sample.post.streamFps) return reason('stream-fps-changed');
  if (sample.pre.dpr !== sample.post.dpr) return reason('dpr-changed');
  const pre = sample.pre.video!, post = sample.post.video!;
  if (Math.abs(pre.volume - post.volume) > 0.005) return reason('effective-volume-changed');
  if (pre.frames == null || post.frames == null || pre.dropped == null || post.dropped == null
    || post.frames < pre.frames || post.dropped < pre.dropped) return reason('frame-counter');
  return progress(sample.pre, sample.post, sample.wallSec, scenario.expected.paused);
}

export function validatePair(rows: Sample[]): Reason | null {
  if (rows.length !== 2 || rows.some(row => !row.accepted || !row.measurement)) return null;
  const a = rows[0].measurement!.pre, b = rows[1].measurement!.pre;
  if (a.fmt !== b.fmt || a.afmt !== b.afmt || a.streamFps !== b.streamFps || a.dpr !== b.dpr) {
    return reason('pair-conditions', 'Builds received different codecs, frame rates or DPR');
  }
  if (!a.video || !b.video || Math.abs(a.video.currentTime - b.video.currentTime) > 0.5) {
    return reason('pair-fragment', 'Measurement start positions differ by more than 500 ms');
  }
  return null;
}
