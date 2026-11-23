/**
 * The echo-reduction regression gate: what the shipped DSP does to a known voice in known rooms,
 * held to the behaviour of `dev` when the gate was written (TME-280), with margins. It runs the
 * WebAssembly in node on built-in material, so it needs no browser and no audio files.
 *
 * The limits are one-sided. A change may cost the voice less or lower the tail further without
 * touching this file; costing the voice more, or giving up more than 1 dB of tail, has to be a
 * decision: measure it with `pnpm audio:lab`, then move the limit in the same change.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { LAB_EFFECTS } from './effects';
import type { Material } from './material';
import { levelRows } from './measure';
import { syntheticMaterial } from './synthetic';

type Limits = {
  /** Voice level change while speaking, dB: at least this. */
  voice: number;
  /** Word-ending level change, dB: at least this. */
  ending: number;
  /** Level movement, dB: at most this. */
  movement: number;
  /** Reverb level change in the pause tails, dB: at most this. Absent where there is no room. */
  tail?: number;
};

// Measured on dev (a04471ca), direct-sound reference, 5 s clips; in brackets the value then.
const GATE: Record<string, Record<'light' | 'strong', Limits>> = {
  'synthetic-dry': {
    light: { voice: -2.0 /* -1.62 */, ending: -4.7 /* -3.90 */, movement: 2.4 /* 2.05 */ },
    strong: { voice: -3.8 /* -3.37 */, ending: -9.0 /* -8.14 */, movement: 3.9 /* 3.58 */ }
  },
  'synthetic-wall': {
    light: { voice: -1.9 /* -1.53 */, ending: -3.8 /* -3.02 */, movement: 2.0 /* 1.71 */, tail: -6.0 /* -7.00 */ },
    strong: { voice: -3.3 /* -2.93 */, ending: -7.0 /* -6.24 */, movement: 3.5 /* 3.14 */, tail: -9.0 /* -10.00 */ }
  },
  'synthetic-room-0.8s': {
    light: { voice: -1.7 /* -1.31 */, ending: -3.9 /* -3.08 */, movement: 1.8 /* 1.47 */, tail: -4.9 /* -5.88 */ },
    strong: { voice: -3.1 /* -2.66 */, ending: -7.1 /* -6.30 */, movement: 3.1 /* 2.77 */, tail: -8.7 /* -9.67 */ }
  }
};

async function changes(material: Material, level: 'light' | 'strong'): Promise<(id: string) => number> {
  const effect = LAB_EFFECTS.find(candidate => candidate.id === `echo-${level}`);
  assert.ok(effect);
  const rows = levelRows(material, await effect.run(material.mix));
  return id => {
    const row = rows.find(candidate => candidate.id === id);
    assert.ok(row, `the lab reports ${id}`);
    return row.after - row.before;
  };
}

describe('echo reduction regression gate', () => {
  for (const [id, levels] of Object.entries(GATE)) {
    const material = syntheticMaterial(id, 5);
    const tails: Partial<Record<'light' | 'strong', number>> = {};

    for (const level of ['light', 'strong'] as const) {
      it(`${id}, ${level}: keeps the voice and lowers the tail as dev does`, async () => {
        const limits = levels[level];
        const change = await changes(material, level);
        const [voice, ending, movement] = [change('voice-level-direct'), change('word-ending-level-direct'), change('level-movement-direct')];
        assert.ok(voice >= limits.voice, `voice loss ${voice.toFixed(2)} dB, limit ${limits.voice} dB`);
        assert.ok(ending >= limits.ending, `word-ending loss ${ending.toFixed(2)} dB, limit ${limits.ending} dB`);
        assert.ok(movement <= limits.movement, `level movement ${movement.toFixed(2)} dB, limit ${limits.movement} dB`);
        // An effect that does nothing would pass every limit above.
        assert.ok(voice < -0.05 || limits.tail !== undefined, 'the effect is running');
        if (limits.tail === undefined) return;
        tails[level] = change('tail-level');
        assert.ok(tails[level] <= limits.tail, `tail drop ${tails[level].toFixed(2)} dB, limit ${limits.tail} dB`);
      });
    }

    if (levels.light.tail !== undefined) {
      it(`${id}: Strong lowers the tail at least 2.5 dB further than Light`, () => {
        assert.ok(tails.light !== undefined && tails.strong !== undefined, 'both levels were measured');
        assert.ok(tails.strong <= tails.light - 2.5, `${(tails.strong - tails.light).toFixed(2)} dB`);
      });
    }
  }
});
