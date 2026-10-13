import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from '../../src/audio-settings';

export type NativeSettings = { stable: boolean; voice: boolean; cinematic: boolean };
export type Transition = 'none' | 'neutralize' | 'exit' | 'navigate';
export type State = {
  extension: boolean; theater: boolean; rte: boolean; audio: AudioSettings; boost: number;
  paused: boolean; bar: 'any' | 'focused' | 'hidden'; native: NativeSettings;
  transition: Transition; allowStableForcedOff?: boolean; captions: boolean;
};
const nativeOff: NativeSettings = { stable: false, voice: false, cinematic: false };
const base: Omit<State, 'captions'> = { extension: false, theater: false, rte: false, audio: DEFAULT_AUDIO_SETTINGS,
  boost: 1, paused: false, bar: 'any', native: nativeOff, transition: 'none' };
// captions stays last so a saved state that predates the field still matches after the default is appended.
const state = (value: Omit<State, 'captions'>, captions = false): State => ({ ...value, captions });
const neutral: Omit<State, 'captions'> = { ...base, extension: true, theater: true, rte: true };
export const activeAudio: AudioSettings = { voice: 'strong', leveling: 'strong', bass: 'more' };
export const STATES = {
  reference: state(base),
  neutral: state(neutral),
  'native-cinematic': state({ ...base, native: { ...nativeOff, cinematic: true } }),
  'native-voice': state({ ...base, native: { ...nativeOff, voice: true } }),
  'native-stable': state({ ...base, native: { ...nativeOff, stable: true } }),
  'native-all': state({ ...base, native: { stable: true, voice: true, cinematic: true }, allowStableForcedOff: true }),
  'boost-focused': state({ ...neutral, boost: 3, bar: 'focused' }),
  'boost-hidden': state({ ...neutral, boost: 3, bar: 'hidden' }),
  active: state({ ...neutral, audio: activeAudio }),
  paused: state({ ...neutral, audio: activeAudio, paused: true }),
  'effects-disabled': state({ ...neutral, transition: 'neutralize' }),
  'extension-loaded': state({ ...base, extension: true }),
  'rte-off': state({ ...neutral, rte: false }),
  'voice-only': state({ ...neutral, audio: { ...DEFAULT_AUDIO_SETTINGS, voice: 'strong' } }),
  'leveling-only': state({ ...neutral, audio: { ...DEFAULT_AUDIO_SETTINGS, leveling: 'strong' } }),
  'bass-only': state({ ...neutral, audio: { ...DEFAULT_AUDIO_SETTINGS, bass: 'more' } }),
  captions: state(neutral, true),
  'after-exit': state({ ...base, extension: true, rte: true, transition: 'exit' }),
  'after-navigation': state({ ...neutral, audio: activeAudio, transition: 'navigate' })
} satisfies Record<string, State>;
export type StateName = keyof typeof STATES;
export const DEFAULT_STATES: StateName[] = ['reference', 'neutral', 'native-cinematic', 'boost-focused',
  'native-voice', 'boost-hidden', 'native-stable', 'active', 'native-all', 'paused', 'effects-disabled',
  'extension-loaded', 'rte-off', 'voice-only', 'leveling-only', 'bass-only'];
export type VideoSpec = { url: string; id: string; quality: string; width: number; height: number; fps: number | null; startSec: number };
export type Config = { video: VideoSpec; navigationVideo: VideoSpec | null; states: StateName[];
  profile: 'default' | 'extended'; warmupMs: number; windowMs: number; rounds: number;
  attempts: number; scatterPp: number; scatterExtra: number; extension: { name: string; path: string; sha?: string } };
export type Scenario = { id: string; state: StateName; video: VideoSpec; target: VideoSpec; expected: State };
export type Build = { id: string; path: string; hash: string; version: string; sourceSha: string | null };
export type Environment = { platform: string; host: string; cpu: string; cores: number; memoryBytes: number;
  chromePath: string; chromeVersion: string; displayBackend: string; gpu: unknown;
  viewport: [number, number]; dpr: number | null; audioMutedByBrowser: boolean };
export type Manifest = { formatVersion: 1; id: string; createdAt: string; mode: 'run' | 'compare' | 'probe';
  config: Config; scenarios: Scenario[]; builds: Build[]; environment: Environment; threshold: number;
  load: { median: number; p95: number; samples: number[] } };
export type NativeSnapshot = { stable: boolean | null; voice: boolean | null; cinematic: boolean | null;
  cinematicChildren: number; theme: string | null };
export type AudioGraphSnapshot = { state: AudioContextState; gain: number | null };
export type PlayerSnapshot = {
  href: string; videoId: string | null; videoToken: number | null; theater: boolean; integrationOff: boolean;
  rteSignal: boolean; focus: boolean; inner: [number, number]; dpr: number;
  barVisible: boolean; sliderFocused: boolean; sliderFocusVisible: boolean; ad: boolean; captionsVisible: boolean;
  nativeVolume: number | null; quality: string | null; fmt: string | null; afmt: string | null; streamFps: number | null;
  native: NativeSnapshot;
  video: { paused: boolean; muted: boolean; volume: number; readyState: number; currentTime: number;
    rate: number; error: string | null; width: number; height: number; boost: number | null;
    audio: AudioSettings | null; graphReady: boolean; graph: AudioGraphSnapshot | null;
    dropped: number | null; frames: number | null } | null;
};
export type Reason = { code: string; detail: string };
export type Measurement = { wallSec: number; rendererPct: number | null; threadPct: number | null;
  familyPct: number | null; gpuPct: number | null; nonChromePct: number | null;
  counterError: string | null; processSetChanged: boolean; pre: PlayerSnapshot; post: PlayerSnapshot };
export type Sample = { experimentId: string; scenarioId: string; state: StateName; buildId: string;
  round: number; attempt: number; pairId: string | null; accepted: boolean; reason: Reason | null;
  measuredAt: string; measurement: Measurement | null; warmup: { pre: PlayerSnapshot; post: PlayerSnapshot; wallSec: number } | null };
export const reason = (code: string, detail = code): Reason => ({ code, detail });
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
export function scenarios(config: Config): Scenario[] {
  const videos = config.profile === 'extended'
    ? [config.video, { ...config.video, quality: 'hd1080', width: 1920, height: 1080, fps: 60 }]
    : [config.video];
  return videos.flatMap(video => config.states.map(state => ({ id: `${state}@${video.height}${video.fps ? `p${video.fps}` : ''}`,
    state, video, target: state === 'after-navigation' ? { ...config.navigationVideo!, quality: video.quality,
      width: video.width, height: video.height, fps: video.fps } : video, expected: STATES[state] })));
}
