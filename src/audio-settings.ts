import { stepLevel } from './step-level';

export const VOICE_LEVELS = ['off', 'light', 'strong'] as const;
export const LEVELING_LEVELS = ['off', 'light', 'strong'] as const;
export const ECHO_LEVELS = ['off', 'light', 'strong'] as const;
const ALL_BASS_LEVELS = ['less', 'original', 'more', 'moar', 'moaaarr'] as const;

/**
 * Gates the top bass level (MOAAARR!, about +12 dB) pending real-world listening: it is a candidate to ship
 * in a later release. Off removes it from the settings row, shortcut cycle and HUD, and a stored 'moaaarr'
 * resolves to 'moar'. The rest of the chain keeps it, so turning this on is the only change needed.
 */
export const BASS_MOAAARR_ENABLED = true;

export function bassLevels(moaaarrEnabled: boolean): readonly (typeof ALL_BASS_LEVELS)[number][] {
  return moaaarrEnabled ? ALL_BASS_LEVELS : ALL_BASS_LEVELS.filter((level) => level !== 'moaaarr');
}
export const BASS_LEVELS = bassLevels(BASS_MOAAARR_ENABLED);

/** A saved 'moaaarr' stays valid as 'moar' while the top level is gated. */
export function resolveBassLevel(value: unknown, moaaarrEnabled = BASS_MOAAARR_ENABLED): AudioSettings['bass'] {
  return pick(bassLevels(moaaarrEnabled), value === 'moaaarr' && !moaaarrEnabled ? 'moar' : value, DEFAULT_AUDIO_SETTINGS.bass);
}

export type AudioSettings = {
  voice: typeof VOICE_LEVELS[number];
  leveling: typeof LEVELING_LEVELS[number];
  bass: typeof ALL_BASS_LEVELS[number];
  echo: typeof ECHO_LEVELS[number];
};
export type AudioSettingName = keyof AudioSettings;

// Menu order. Echo reduction runs first in the chain but is the most specialised, so its row comes last.
export const AUDIO_SETTING_NAMES: readonly AudioSettingName[] = ['voice', 'leveling', 'bass', 'echo'];
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { voice: 'off', leveling: 'off', bass: 'original', echo: 'off' };

export const AUDIO_STORAGE_KEYS: Record<AudioSettingName, string> = {
  voice: 'voiceBoost',
  leveling: 'volumeLeveling',
  bass: 'bassLevel',
  echo: 'echoReduction'
};

/**
 * Dispatched on the media element; levels travel in its data-theater-* attributes. The MAIN world
 * dispatches it too when an effect turns out unavailable there (`echoUnavailable`).
 */
export const AUDIO_SETTINGS_EVENT = 'theater-everywhere-audio';

/** Set by the MAIN world when this page cannot run echo reduction (see `echoStage`). */
export function echoUnavailable(media: HTMLElement): boolean {
  return media.dataset.theaterEchoUnavailable === 'true';
}
const DATASET_KEYS: Record<AudioSettingName, string> = {
  voice: 'theaterVoice',
  leveling: 'theaterLeveling',
  bass: 'theaterBass',
  echo: 'theaterEcho'
};

const LEVEL_LABEL_KEYS: { [N in AudioSettingName]: Record<AudioSettings[N], string> } = {
  voice: { off: 'voiceBoostOff', light: 'voiceBoostLight', strong: 'voiceBoostStrong' },
  leveling: { off: 'volumeLevelingOff', light: 'volumeLevelingLight', strong: 'volumeLevelingStrong' },
  bass: { less: 'bassLess', original: 'bassOriginal', more: 'bassMore', moar: 'bassMoar', moaaarr: 'bassMoaaarr' },
  // The same words as Voice boost's levels; each language names the Echo reduction row so they agree with it.
  echo: { off: 'voiceBoostOff', light: 'voiceBoostLight', strong: 'voiceBoostStrong' }
};
/** Why audio settings cannot apply to a video, with the message that explains it. */
export type AudioBlock = 'protected' | 'refused';
export const AUDIO_BLOCK_KEYS: Record<AudioBlock, string> = {
  protected: 'audioProtected',
  refused: 'audioRefused'
};
export const AUDIO_LABEL_KEYS: Record<AudioSettingName, string> = {
  voice: 'voiceBoostLabel',
  leveling: 'volumeLevelingLabel',
  bass: 'bassLabel',
  echo: 'echoReductionLabel'
};
export const AUDIO_HUD_KEYS: Record<AudioSettingName, string> = {
  voice: 'voiceBoostHud',
  leveling: 'volumeLevelingHud',
  bass: 'bassHud',
  echo: 'echoReductionHud'
};

function pick<T extends string>(levels: readonly T[], value: unknown, fallback: T): T {
  return levels.find((level) => level === value) ?? fallback;
}

/** The ordered levels each setting offers. */
const LEVELS: { [N in AudioSettingName]: readonly AudioSettings[N][] } = {
  voice: VOICE_LEVELS,
  leveling: LEVELING_LEVELS,
  bass: BASS_LEVELS,
  echo: ECHO_LEVELS
};

function withLevel<N extends AudioSettingName>(settings: AudioSettings, name: N, level: AudioSettings[N]): AudioSettings {
  return { ...settings, [name]: level };
}

/** Reads every level from any key/value source, falling back per setting. */
export function resolveAudioSettings(read: (name: AudioSettingName) => unknown): AudioSettings {
  return {
    voice: pick(VOICE_LEVELS, read('voice'), DEFAULT_AUDIO_SETTINGS.voice),
    leveling: pick(LEVELING_LEVELS, read('leveling'), DEFAULT_AUDIO_SETTINGS.leveling),
    bass: resolveBassLevel(read('bass')),
    echo: pick(ECHO_LEVELS, read('echo'), DEFAULT_AUDIO_SETTINGS.echo)
  };
}

export function resolveStoredAudioSettings(data: Record<string, unknown>): AudioSettings {
  return resolveAudioSettings((name) => data[AUDIO_STORAGE_KEYS[name]]);
}

export function readAudioDataset(dataset: DOMStringMap): AudioSettings {
  return resolveAudioSettings((name) => dataset[DATASET_KEYS[name]]);
}

/** Returns whether any attribute changed. */
export function writeAudioDataset(dataset: DOMStringMap, settings: AudioSettings): boolean {
  let changed = false;
  for (const name of AUDIO_SETTING_NAMES) {
    const key = DATASET_KEYS[name];
    if (dataset[key] === settings[name]) continue;
    dataset[key] = settings[name];
    changed = true;
  }
  return changed;
}

/** The next level, wrapping from the last to the first. */
export function cycleAudioSetting<N extends AudioSettingName>(settings: AudioSettings, name: N): AudioSettings {
  const levels = LEVELS[name];
  return withLevel(settings, name, levels[(levels.indexOf(settings[name]) + 1) % levels.length]);
}

/** The ordered levels a setting offers, for a stepper that shows every option. */
export function audioLevels<N extends AudioSettingName>(name: N): readonly AudioSettings[N][] {
  return LEVELS[name];
}

/** One level down or up, held at either end; the cycle shortcuts keep wrapping with `cycleAudioSetting`. */
export function stepAudioSetting<N extends AudioSettingName>(settings: AudioSettings, name: N, direction: 1 | -1): AudioSettings {
  return withLevel(settings, name, stepLevel(LEVELS[name], settings[name], direction));
}

export function audioLevelLabelKey<N extends AudioSettingName>(settings: AudioSettings, name: N): string {
  return (LEVEL_LABEL_KEYS[name] as Record<AudioSettings[N], string>)[settings[name]];
}

/** The Bass row sweeps in red when the level rises into or within the red levels (MOAAR, MOAAARR!). */
export function bassRowSweeps(previous: AudioSettings['bass'] | undefined, next: AudioSettings['bass']): boolean {
  if (previous === undefined || (next !== 'moar' && next !== 'moaaarr')) return false;
  return BASS_LEVELS.indexOf(next) > BASS_LEVELS.indexOf(previous);
}

/** A level other than the default is what the settings rows highlight. */
export function isAudioSettingActive(settings: AudioSettings, name: AudioSettingName): boolean {
  return settings[name] !== DEFAULT_AUDIO_SETTINGS[name];
}

/** Untouched audio needs no Web Audio graph at all. */
export function isNeutralAudio(settings: AudioSettings): boolean {
  return AUDIO_SETTING_NAMES.every((name) => settings[name] === DEFAULT_AUDIO_SETTINGS[name]);
}

export function sameAudioSettings(left: AudioSettings, right: AudioSettings): boolean {
  return AUDIO_SETTING_NAMES.every((name) => left[name] === right[name]);
}
