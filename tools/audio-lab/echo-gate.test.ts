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

type Level = 'light' | 'strong';
type Limits = {
  /** Voice level change while speaking, dB: at least this. */
  voice: number;
  /** Level change of the speech in the last 60 ms before a pause, dB: at least this. */
  ending: number;
  /** Level movement, dB: at most this. */
  movement: number;
  /** Late-reverb level change in the pause tails, dB: at most this. Absent where there is no room. */
  tail?: number;
};
type Room = Record<Level, Limits> & {
  /** How much further Strong lowers the tail than Light, dB: at least this. Absent where there is no room. */
  separation?: number;
};

// Measured on dev (a04471ca), direct-sound reference, 5 s clips; in brackets the value then.
// Margins: voice 0.4 dB, endings 0.8 dB, movement 0.3 dB, tail and separation 1 dB.
const GATE: Record<string, Room> = {
  'synthetic-dry': {
    light: { voice: -2.0 /* -1.62 */, ending: -4.9 /* -4.15 */, movement: 2.4 /* 2.05 */ },
    strong: { voice: -3.8 /* -3.37 */, ending: -9.1 /* -8.34 */, movement: 3.9 /* 3.58 */ }
  },
  // The wall room's tail limits are those of TME-279, measured on its DSP with a 0.5 dB margin; dev had
  // -7.00, -10.00 and 3.00 here. This room's reflections end 50 ms after the voice, and its tail is short
  // and weak (9 % of the reflected energy). Dev lowered everything after an onset to the floor, the voice
  // included. TME-279 keeps the level through the end of a word, and in this room that reaches into the
  // first 30 ms of the measured tail, where most of its energy is; from 100 ms after the voice the gain is
  // at the floor as before. A nearly intact voice for less tail in short wall rooms is the accepted trade.
  'synthetic-wall': {
    light: { voice: -1.9 /* -1.53 */, ending: -3.9 /* -3.12 */, movement: 2.0 /* 1.71 */, tail: -3.0 /* -3.47 */ },
    strong: { voice: -3.3 /* -2.93 */, ending: -7.2 /* -6.38 */, movement: 3.4 /* 3.14 */, tail: -3.9 /* -4.42 */ },
    separation: 0.5 /* 0.96 */
  },
  'synthetic-room-0.8s': {
    light: { voice: -1.7 /* -1.31 */, ending: -4.0 /* -3.22 */, movement: 1.8 /* 1.47 */, tail: -4.9 /* -5.88 */ },
    strong: { voice: -3.1 /* -2.66 */, ending: -7.3 /* -6.51 */, movement: 3.1 /* 2.77 */, tail: -8.7 /* -9.67 */ },
    separation: 2.8 /* 3.79 */
  }
};

type Changes = { voice: number; ending: number; movement: number; tail?: number };

async function measureChanges(material: Material, level: Level): Promise<Changes> {
  const effect = LAB_EFFECTS.find(candidate => candidate.id === `echo-${level}`);
  assert.ok(effect);
  const rows = levelRows(material, await effect.run(material.mix));
  const change = (id: string) => {
    const row = rows.find(candidate => candidate.id === id);
    return row ? row.after - row.before : undefined;
  };
  const [voice, ending, movement] = [change('voice-level-direct'), change('word-ending-level-direct'), change('level-movement-direct')];
  assert.ok(voice !== undefined && ending !== undefined && movement !== undefined, 'the lab reports the voice rows');
  return { voice, ending, movement, tail: change('tail-level') };
}

describe('echo reduction regression gate', () => {
  for (const [id, room] of Object.entries(GATE)) {
    const material = syntheticMaterial(id, 5);
    // Each level is measured once, by whichever test asks first, so every test stands on its own.
    const runs = new Map<Level, Promise<Changes>>();
    const changes = (level: Level): Promise<Changes> => {
      if (!runs.has(level)) runs.set(level, measureChanges(material, level));
      return runs.get(level)!;
    };

    for (const level of ['light', 'strong'] as const) {
      it(`${id}, ${level}: keeps the voice and lowers the tail as dev does`, async () => {
        const limits = room[level];
        const { voice, ending, movement, tail } = await changes(level);
        assert.ok(voice >= limits.voice, `voice loss ${voice.toFixed(2)} dB, limit ${limits.voice} dB`);
        assert.ok(ending >= limits.ending, `word-ending loss ${ending.toFixed(2)} dB, limit ${limits.ending} dB`);
        assert.ok(movement <= limits.movement, `level movement ${movement.toFixed(2)} dB, limit ${limits.movement} dB`);
        if (limits.tail === undefined) return;
        // The tail limit is also what proves the effect runs: one that did nothing would pass the lines above.
        assert.ok(tail !== undefined && tail <= limits.tail, `tail drop ${tail?.toFixed(2)} dB, limit ${limits.tail} dB`);
      });
    }

    const { separation } = room;
    if (separation !== undefined) {
      it(`${id}: Strong lowers the tail at least ${separation} dB further than Light`, async () => {
        const [light, strong] = [await changes('light'), await changes('strong')];
        assert.ok(light.tail !== undefined && strong.tail !== undefined, 'both levels have a tail');
        assert.ok(strong.tail <= light.tail - separation, `${(strong.tail - light.tail).toFixed(2)} dB`);
      });
    }
  }
});
