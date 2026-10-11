export const VOICE_BOOST_STORAGE_KEY = 'voiceBoost';
/** Dispatched on the media element; the level travels in its data-theater-voice. */
export const VOICE_BOOST_EVENT = 'theater-everywhere-voice-boost';
export const VOICE_BOOST_LEVELS = ['off', 'light', 'strong'] as const;
export type VoiceBoostLevel = typeof VOICE_BOOST_LEVELS[number];
export const DEFAULT_VOICE_BOOST: VoiceBoostLevel = 'off';

export function resolveVoiceBoost(value: unknown): VoiceBoostLevel {
  return VOICE_BOOST_LEVELS.find((level) => level === value) ?? DEFAULT_VOICE_BOOST;
}

const LABEL_KEYS: Record<VoiceBoostLevel, string> = {
  off: 'voiceBoostOff',
  light: 'voiceBoostLight',
  strong: 'voiceBoostStrong'
};

export function voiceBoostLabelKey(level: VoiceBoostLevel): string {
  return LABEL_KEYS[level];
}

export function nextVoiceBoost(level: VoiceBoostLevel): VoiceBoostLevel {
  return VOICE_BOOST_LEVELS[(VOICE_BOOST_LEVELS.indexOf(level) + 1) % VOICE_BOOST_LEVELS.length];
}
