export const VOICE_LEVELS = ['off', 'light', 'strong'] as const;
export const LEVELING_LEVELS = ['off', 'light', 'strong'] as const;
export const BASS_LEVELS = ['less', 'original', 'more'] as const;

export type AudioSettings = {
  voice: typeof VOICE_LEVELS[number];
  leveling: typeof LEVELING_LEVELS[number];
  bass: typeof BASS_LEVELS[number];
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
  bass: { less: 'bassLess', original: 'bassOriginal', more: 'bassMore' }
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
    bass: pick(BASS_LEVELS, read('bass'), DEFAULT_AUDIO_SETTINGS.bass)
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

/** Untouched audio needs no Web Audio graph at all. */
export function isNeutralAudio(settings: AudioSettings): boolean {
  return AUDIO_SETTING_NAMES.every((name) => settings[name] === DEFAULT_AUDIO_SETTINGS[name]);
}

export function sameAudioSettings(left: AudioSettings, right: AudioSettings): boolean {
  return AUDIO_SETTING_NAMES.every((name) => left[name] === right[name]);
}
