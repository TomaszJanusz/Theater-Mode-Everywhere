import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AUDIO_SETTING_NAMES,
  BASS_LEVELS,
  audioLevelLabelKey,
  cycleAudioSetting,
  stepAudioSetting,
  audioLevels,
  bassLevels,
  bassRowSweeps,
  isAudioSettingActive,
  resolveBassLevel,
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
    // Cycling starts at 'original' and wraps, whichever top levels are configured.
    const originalIndex = BASS_LEVELS.indexOf('original');
    const expected = [...BASS_LEVELS.slice(originalIndex + 1), ...BASS_LEVELS.slice(0, originalIndex + 1)];
    for (let step = 0; step < BASS_LEVELS.length; step++) { bass = cycleAudioSetting(bass, 'bass'); order.push(bass.bass); }
    assert.deepEqual(order, expected);
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

  it('marks only non-default levels as active', () => {
    assert.deepEqual(AUDIO_SETTING_NAMES.filter(name => isAudioSettingActive(DEFAULT_AUDIO_SETTINGS, name)), []);
    const tuned = { voice: 'light', leveling: 'off', bass: 'less' } as const;
    assert.deepEqual(AUDIO_SETTING_NAMES.filter(name => isAudioSettingActive(tuned, name)), ['voice', 'bass']);
  });

  it('gates the top bass level behind one flag', () => {
    assert.deepEqual(bassLevels(false), ['less', 'original', 'more', 'moar']);
    assert.deepEqual(bassLevels(true), ['less', 'original', 'more', 'moar', 'moaaarr']);
    assert.equal(resolveBassLevel('moaaarr', false), 'moar', 'a saved top level falls back to MOAAR');
    assert.equal(resolveBassLevel('moaaarr', true), 'moaaarr');
    assert.equal(resolveBassLevel('bogus', false), 'original');
  });

  it('sweeps the Bass row only when the level rises into a red level', () => {
    assert.equal(bassRowSweeps('more', 'moar'), true);
    assert.equal(bassRowSweeps('original', 'moar'), true);
    assert.equal(bassRowSweeps('moar', 'moaaarr'), true);
    assert.equal(bassRowSweeps('moaaarr', 'less'), false, 'the wrap down to Less is silent');
    assert.equal(bassRowSweeps('original', 'more'), false);
    assert.equal(bassRowSweeps('moaaarr', 'moar'), false);
    assert.equal(bassRowSweeps(undefined, 'moaaarr'), false, 'the first state never sweeps');
  });
});

describe('stepping audio levels', () => {
  it('moves one level and holds at either end, unlike the wrapping cycle', () => {
    for (const name of AUDIO_SETTING_NAMES) {
      const levels = audioLevels(name);
      let settings = { ...DEFAULT_AUDIO_SETTINGS, [name]: levels[0] };
      assert.equal(stepAudioSetting(settings, name, -1)[name], levels[0]);
      for (let index = 1; index < levels.length; index++) {
        settings = stepAudioSetting(settings, name, 1);
        assert.equal(settings[name], levels[index]);
      }
      assert.equal(stepAudioSetting(settings, name, 1)[name], levels.at(-1));
      assert.equal(cycleAudioSetting(settings, name)[name], levels[0]);
      assert.equal(stepAudioSetting(settings, name, -1)[name], levels.at(-2));
    }
  });

  it('only changes the named setting', () => {
    const settings = { voice: 'light', leveling: 'strong', bass: 'more' } as const;
    assert.deepEqual(stepAudioSetting(settings, 'bass', -1), { ...settings, bass: 'original' });
  });
});
