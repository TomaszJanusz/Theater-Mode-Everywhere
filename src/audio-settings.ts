export const VOICE_LEVELS = ['off', 'light', 'strong'] as const;
export const LEVELING_LEVELS = ['off', 'light', 'strong'] as const;
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
};
export type AudioSettingName = keyof AudioSettings;

export const AUDIO_SETTING_NAMES: readonly AudioSettingName[] = ['voice', 'leveling', 'bass'];
export const DEFAULT_AUDIO_SETTINGS: AudioSettings = { voice: 'off', leveling: 'off', bass: 'original' };

export const AUDIO_STORAGE_KEYS: Record<AudioSettingName, string> = {
  voice: 'voiceBoost',
  leveling: 'volumeLeveling',
  bass: 'bassLevel'
};

/** Dispatched on the media element; levels travel in its data-theater-* attributes. */
export const AUDIO_SETTINGS_EVENT = 'theater-everywhere-audio';
const DATASET_KEYS: Record<AudioSettingName, string> = {
  voice: 'theaterVoice',
  leveling: 'theaterLeveling',
  bass: 'theaterBass'
};

const LEVEL_LABEL_KEYS: { [N in AudioSettingName]: Record<AudioSettings[N], string> } = {
  voice: { off: 'voiceBoostOff', light: 'voiceBoostLight', strong: 'voiceBoostStrong' },
  leveling: { off: 'volumeLevelingOff', light: 'volumeLevelingLight', strong: 'volumeLevelingStrong' },
  bass: { less: 'bassLess', original: 'bassOriginal', more: 'bassMore', moar: 'bassMoar', moaaarr: 'bassMoaaarr' }
};
/** Every label a row can show, so a menu can reserve room for the widest. */
export function audioLevelLabelKeys(name: AudioSettingName): string[] {
  return Object.values(LEVEL_LABEL_KEYS[name]);
}

/** Why audio settings cannot apply to a video, with the message that explains it. */
export type AudioBlock = 'protected' | 'refused';
export const AUDIO_BLOCK_KEYS: Record<AudioBlock, string> = {
  protected: 'audioProtected',
  refused: 'audioRefused'
};
export const AUDIO_LABEL_KEYS: Record<AudioSettingName, string> = {
  voice: 'voiceBoostLabel',
  leveling: 'volumeLevelingLabel',
  bass: 'bassLabel'
};
export const AUDIO_HUD_KEYS: Record<AudioSettingName, string> = {
  voice: 'voiceBoostHud',
  leveling: 'volumeLevelingHud',
  bass: 'bassHud'
};

function pick<T extends string>(levels: readonly T[], value: unknown, fallback: T): T {
  return levels.find((level) => level === value) ?? fallback;
}

function cycle<T extends string>(levels: readonly T[], level: T): T {
  return levels[(levels.indexOf(level) + 1) % levels.length];
}

/** Reads the three levels from any key/value source, falling back per setting. */
export function resolveAudioSettings(read: (name: AudioSettingName) => unknown): AudioSettings {
  return {
    voice: pick(VOICE_LEVELS, read('voice'), DEFAULT_AUDIO_SETTINGS.voice),
    leveling: pick(LEVELING_LEVELS, read('leveling'), DEFAULT_AUDIO_SETTINGS.leveling),
    bass: resolveBassLevel(read('bass'))
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

export function cycleAudioSetting(settings: AudioSettings, name: AudioSettingName): AudioSettings {
  switch (name) {
    case 'voice': return { ...settings, voice: cycle(VOICE_LEVELS, settings.voice) };
    case 'leveling': return { ...settings, leveling: cycle(LEVELING_LEVELS, settings.leveling) };
    case 'bass': return { ...settings, bass: cycle(BASS_LEVELS, settings.bass) };
  }
}

export function audioLevelLabelKey(settings: AudioSettings, name: AudioSettingName): string {
  switch (name) {
    case 'voice': return LEVEL_LABEL_KEYS.voice[settings.voice];
    case 'leveling': return LEVEL_LABEL_KEYS.leveling[settings.leveling];
    case 'bass': return LEVEL_LABEL_KEYS.bass[settings.bass];
  }
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
