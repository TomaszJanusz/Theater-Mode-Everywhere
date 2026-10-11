import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nextVoiceBoost, resolveVoiceBoost, voiceBoostLabelKey } from './voice-boost-settings';

describe('voice boost setting', () => {
  it('defaults to off for missing or unknown saved values', () => {
    for (const value of [undefined, null, '', 'medium', true, 1, {}]) {
      assert.equal(resolveVoiceBoost(value), 'off');
    }
    assert.equal(resolveVoiceBoost('strong'), 'strong');
  });

  it('cycles off, light, strong and back with a label for each level', () => {
    assert.equal(nextVoiceBoost('off'), 'light');
    assert.equal(nextVoiceBoost('light'), 'strong');
    assert.equal(nextVoiceBoost('strong'), 'off');
    assert.equal(new Set(['off', 'light', 'strong'].map((level) => voiceBoostLabelKey(resolveVoiceBoost(level)))).size, 3);
  });
});
