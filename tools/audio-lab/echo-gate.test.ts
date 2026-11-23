/**
 * The echo-reduction regression gate: what the shipped DSP does to a known voice in known rooms,
 * held to the behaviour of `dev` when the gate was written (TME-280), with margins, and what it
 * must not do to sound that is no echo of a voice. It runs the WebAssembly in node on built-in
 * material, so it needs no browser and no audio files.
 *
 * The limits are one-sided. A change may cost the voice less or lower the tail further without
 * touching this file; costing the voice more, giving up more than 1 dB of tail, or touching music
 * and the bands outside speech has to be a decision: measure it with `pnpm audio:lab`, then move
 * the limit in the same change.
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

/** The change of one lab row in dB, as [Light, Strong]: at most this, at least this, or both. */
type Bound = { atMost?: [number, number]; atLeast?: [number, number] };
type Case = { id: string; seconds?: number; rows: Record<string, Bound> };
const within = (limit: number): Bound => ({ atMost: [limit, limit], atLeast: [-limit, -limit] });

/**
 * Sound the effect must leave alone. In brackets what `dev` did before the gain was tied to speech.
 * A level over a whole clip hides a gain that falls for a fifth of a second and comes back, so the
 * music also has a limit on its largest dip over any 50 ms.
 * - Sustained and plucked music pass: Light and Strong lowered them by 2.8 and 8.7 dB [sustained]
 *   and 1.7 and 2.4 dB [plucked, with dips of 7 and 10 dB].
 * - A chord accent of 180 ms has the shape of a syllable, and no envelope tells them apart. The
 *   accompaniment under it still dips as the accent ends, by 5.2 and 6.7 dB at the worst accent
 *   [6.1 and 9.9 dB], for a fifth of a second and not for as long as it plays: its level over the
 *   clip falls by 0.4 dB [2.9 and 7.8 dB].
 * - Applause dips by 2.5 and 3.3 dB [5.0 and 7.3 dB].
 * - Outside the speech bands a voice in a room changed by up to 3.1 dB, now by 0.08 dB at most;
 *   music under a voice, whose bass notes lie within a bin of the lower edge, by 0.45 dB.
 */
const UNTOUCHED: Case[] = [
  { id: 'synthetic-music-sustained', rows: { 'speech-bands-level': within(0.1), 'outside-speech-bands-level': within(0.1), 'largest-dip-mix': { atMost: [0.1, 0.1] } } },
  { id: 'synthetic-music-plucked', rows: { 'speech-bands-level': within(0.3), 'outside-speech-bands-level': within(0.1), 'largest-dip-mix': { atMost: [1.2, 1.6] } } },
  { id: 'synthetic-music-accents', rows: { 'bed-level': { atLeast: [-0.7, -0.8] }, 'bed-largest-dip': { atMost: [5.7, 7.2] }, 'outside-speech-bands-level': within(0.4) } },
  { id: 'synthetic-applause', rows: { 'speech-bands-level': { atLeast: [-0.9, -1] }, 'largest-dip-mix': { atMost: [3, 3.8] }, 'outside-speech-bands-level': within(0.1) } },
  // The voice speaks through the first half of the clip, so 4.5 s of it are music alone.
  { id: 'synthetic-room-0.8s-then-music', seconds: 12, rows: { 'bed-level-away': within(0.1), 'bed-largest-dip-away': { atMost: [0.1, 0.1] }, 'outside-speech-bands-level': within(0.7) } },
  { id: 'synthetic-dry', seconds: 5, rows: { 'outside-speech-bands-level': within(0.2) } },
  { id: 'synthetic-wall', seconds: 5, rows: { 'outside-speech-bands-level': within(0.2) } },
  { id: 'synthetic-room-0.8s', seconds: 5, rows: { 'outside-speech-bands-level': within(0.2) } }
];

/**
 * Speech that an envelope can take for something else, and must not: its echo has to come down
 * much as `dev` brought it down [in brackets, Light and Strong, late reverb in the pauses].
 * - A vowel held for 1.2 s: -6.7 and -9.5 dB [-6.7 and -9.5].
 * - Speech 1.6 times as fast, at the same pitch and at a higher one: -5.4 and -7.1 dB [-5.7 and
 *   -7.5], -5.6 and -7.5 dB [-6.0 and -8.1].
 * - A voice under music 2 dB louder than itself: -2.5 and -3.9 dB [-4.3 and -8.9]. The voice moves
 *   the level of such a mix too little to be found each time; what is given up in echo is kept in
 *   music, which loses 0.2 and 0.3 dB while the voice speaks [2.9 and 6.8 dB].
 * One case is given up. A word of 90 ms on its own (`synthetic-room-0.3s-short-words`) is over
 * before it can show that it holds its level, as a drum is; its echo passes [-3.9 and -4.8 dB].
 * Counting it would count every struck sound: the plucked music above would lose 1.4 and 1.5 dB.
 */
const FOUND: Case[] = [
  { id: 'synthetic-room-0.3s-long-vowels', rows: { 'tail-level': { atMost: [-5.7, -8.5] } } },
  { id: 'synthetic-room-0.3s-fast', rows: { 'tail-level': { atMost: [-4.4, -6.1] } } },
  { id: 'synthetic-room-0.3s-fast-pitched', rows: { 'tail-level': { atMost: [-4.6, -6.5] } } },
  { id: 'synthetic-room-0.8s-under-music', rows: { 'tail-level': { atMost: [-1.5, -2.9] }, 'bed-level-speech': { atLeast: [-0.8, -0.9] } } }
];

type Changes = { voice: number; ending: number; movement: number; tail?: number };

const effectOf = (level: Level) => {
  const effect = LAB_EFFECTS.find(candidate => candidate.id === `echo-${level}`);
  assert.ok(effect);
  return effect;
};

async function measureChanges(material: Material, level: Level): Promise<Changes> {
  const rows = levelRows(material, await effectOf(level).run(material.mix));
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

for (const [title, cases] of [['echo reduction leaves alone what is no echo of a voice', UNTOUCHED], ['echo reduction finds speech that does not look like a run of syllables', FOUND]] as const) {
  describe(title, () => {
    for (const { id, seconds = 8, rows: bounds } of cases) {
      const material = syntheticMaterial(id, seconds);
      for (const [index, level] of (['light', 'strong'] as const).entries()) {
        it(`${id}, ${level}: ${Object.keys(bounds).join(', ')}`, async () => {
          const rows = levelRows(material, await effectOf(level).run(material.mix));
          for (const [row, { atMost, atLeast }] of Object.entries(bounds)) {
            const found = rows.find(candidate => candidate.id === row);
            assert.ok(found, `the lab reports ${row}`);
            const change = found.after - found.before;
            assert.ok(atMost === undefined || change <= atMost[index], `${row} changed by ${change.toFixed(2)} dB, at most ${atMost?.[index]} dB`);
            assert.ok(atLeast === undefined || change >= atLeast[index], `${row} changed by ${change.toFixed(2)} dB, at least ${atLeast?.[index]} dB`);
          }
        });
      }
    }
  });
}
