import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUDIO_SETTING_NAMES,
  audioLevelLabelKey,
  cycleAudioSetting,
  DEFAULT_AUDIO_SETTINGS,
  isNeutralAudio,
  readAudioDataset,
  resolveStoredAudioSettings,
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
      const seen = new Set<string>();
      let settings = DEFAULT_AUDIO_SETTINGS;
      for (let step = 0; step < 3; step++) {
        seen.add(audioLevelLabelKey(settings, name));
        settings = cycleAudioSetting(settings, name);
        for (const other of AUDIO_SETTING_NAMES) {
          if (other !== name) assert.equal(settings[other], DEFAULT_AUDIO_SETTINGS[other]);
        }
      }
      assert.deepEqual(settings, DEFAULT_AUDIO_SETTINGS, `${name} returns to its default after three steps`);
      assert.equal(seen.size, 3);
    }
    assert.equal(cycleAudioSetting(DEFAULT_AUDIO_SETTINGS, 'bass').bass, 'more');
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
