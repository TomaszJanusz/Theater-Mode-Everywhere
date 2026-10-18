import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUDIO_SETTING_NAMES,
  BASS_LEVELS,
  audioLevelLabelKey,
  cycleAudioSetting,
  DEFAULT_AUDIO_SETTINGS,
  isNeutralAudio,
  LEVELING_LEVELS,
  readAudioDataset,
  resolveStoredAudioSettings,
  VOICE_LEVELS,
  writeAudioDataset
} from './audio-settings';

describe('audio settings', () => {
  it('falls back per setting for missing or unknown saved values', () => {
    for (const value of [undefined, null, '', 'medium', true, 1, {}]) {
      assert.deepEqual(resolveStoredAudioSettings({ voiceBoost: value, volumeLeveling: value, bassLevel: value }), DEFAULT_AUDIO_SETTINGS);
    }
    assert.deepEqual(resolveStoredAudioSettings({ voiceBoost: 'strong', volumeLeveling: 'bogus', bassLevel: 'less' }),
      { voice: 'strong', leveling: 'off', bass: 'less' });
  });

  it('cycles each setting through its levels independently, with a label for every level', () => {
    for (const name of AUDIO_SETTING_NAMES) {
      const levelCount = { voice: VOICE_LEVELS.length, leveling: LEVELING_LEVELS.length, bass: BASS_LEVELS.length };
      const seen = new Set<string>();
      let settings = DEFAULT_AUDIO_SETTINGS;
      for (let step = 0; step < levelCount[name]; step++) {
        seen.add(audioLevelLabelKey(settings, name));
        settings = cycleAudioSetting(settings, name);
        for (const other of AUDIO_SETTING_NAMES) {
          if (other !== name) assert.equal(settings[other], DEFAULT_AUDIO_SETTINGS[other]);
        }
      }
      assert.deepEqual(settings, DEFAULT_AUDIO_SETTINGS, `${name} returns to its default after one full cycle`);
      assert.equal(seen.size, levelCount[name]);
    }
    let bass = DEFAULT_AUDIO_SETTINGS;
    const order = [];
    for (let step = 0; step < 4; step++) { bass = cycleAudioSetting(bass, 'bass'); order.push(bass.bass); }
    assert.deepEqual(order, ['more', 'moar', 'less', 'original']);
  });

  it('round-trips through the media element dataset and reports only real changes', () => {
    const dataset: DOMStringMap = {};
    assert.deepEqual(readAudioDataset(dataset), DEFAULT_AUDIO_SETTINGS);
    const boosted = { voice: 'light', leveling: 'strong', bass: 'more' } as const;
    assert.equal(writeAudioDataset(dataset, boosted), true);
    assert.equal(writeAudioDataset(dataset, boosted), false);
    assert.deepEqual(readAudioDataset(dataset), boosted);
    assert.equal(isNeutralAudio(boosted), false);
    assert.equal(isNeutralAudio(DEFAULT_AUDIO_SETTINGS), true);
  });
});
