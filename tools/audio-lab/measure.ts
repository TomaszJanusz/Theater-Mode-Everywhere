/**
 * Turns one run into metric rows. Each definition lives in its own file under `metrics/`; this
 * module only decides which signal each metric is taken on:
 *
 * - With a known room and an effect that can be followed, the voice and the room's sound are
 *   measured separately at every reference point of `metrics/early-late.ts`.
 * - With a known dry voice over other sound, the voice and that other sound are measured.
 * - Otherwise only the whole mix is known, and the rows say so (`-mix`).
 */
import type { EffectResult } from './effects';
import type { Material } from './material';
import { bandLevel, bandsOf } from './metrics/band-energy';
import { REFERENCE_POINTS } from './metrics/early-late';
import { estoi } from './metrics/estoi';
import { describeFrames, speechInDryVoice, speechInMix, type Frames } from './metrics/frames';
import { framePower, maskedLevel, powerGrid, splitGrids, voiceBand, type Grid } from './metrics/grid';
import { levelMovement } from './metrics/level-movement';
import { loudness } from './metrics/loudness';
import { srmr } from './metrics/srmr';
import { tailLevel } from './metrics/tail-decay';
import { voiceLevel } from './metrics/voice-loss';
import { wordEndingLevel } from './metrics/word-ending-loss';
import type { MetricRow, Signal } from './types';

type Pair<T> = { before: T; after: T };
/** One way of telling voice from room: what counts as voice, and what is left over as the room's sound (when a room is known). */
type View = { key: string; of: string; voice: Pair<Grid>; room?: Pair<Grid>; note?: string };

/** `first` plus (or, with `sign` -1, minus) every signal of `rest`, sample by sample. */
function combine(first: Signal, rest: Signal[], sign: 1 | -1): Signal {
  const channels = first.channels.map((channel, index) => {
    const out = Float32Array.from(channel);
    for (const signal of rest) {
      const other = signal.channels[index];
      for (let i = 0; i < out.length; i++) out[i] += sign * other[i];
    }
    return out;
  });
  return { sampleRate: first.sampleRate, channels };
}
const sum = (signals: Signal[]): Signal => combine(signals[0], signals.slice(1), 1);
const minus = (a: Signal, b: Signal): Signal => combine(a, [b], -1);

const grids = (pair: Pair<Signal>): Pair<Grid> => ({ before: powerGrid(pair.before), after: powerGrid(pair.after) });
const each = (pair: Pair<Grid>, measure: (grid: Grid) => number): Pair<number> => ({ before: measure(pair.before), after: measure(pair.after) });
const speechLevel = (grid: Grid, frames: Frames): number => maskedLevel(framePower(grid, voiceBand(grid)), frames.speech);

function views(material: Material, { follow }: EffectResult, mix: Pair<Grid>): View[] {
  const { room, voice } = material;
  if (room && follow) {
    const [before, after] = [splitGrids(room.parts), splitGrids(room.parts.map(follow))];
    return REFERENCE_POINTS.map((point, index) => ({
      key: point.key,
      of: point.label,
      voice: { before: before.head[index], after: after.head[index] },
      room: { before: before.rest[index], after: after.rest[index] },
      note: index === 0 ? undefined : `${Math.round(100 * room.shares[point.key])} % of this room's reflected energy arrives within the ${point.label} and counts as voice here`
    }));
  }
  if (voice && follow) return [{ key: 'direct', of: 'dry voice', voice: grids({ before: voice, after: follow(voice) }) }];
  return [{ key: 'mix', of: 'whole mix', voice: mix, note: 'Measured on the whole mix: music, effects and room count as much as the voice' }];
}

function viewRows({ key, of, voice, room, note }: View, frames: Frames, first: boolean): MetricRow[] {
  const rows: MetricRow[] = [
    { id: `voice-level-${key}`, label: `${key === 'mix' ? 'Level' : 'Voice level'} while speaking (${of})`, unit: 'dBFS', ...each(voice, grid => voiceLevel(grid, frames)), higherIsBetter: true, note },
    { id: `word-ending-level-${key}`, label: `Word endings, last 60 ms (${of})`, unit: 'dBFS', ...each(voice, grid => wordEndingLevel(grid, frames)), higherIsBetter: true },
    { id: `level-movement-${key}`, label: `Level movement while speaking (${of})`, unit: 'dB', before: 0, after: levelMovement(voice.before, voice.after, frames), higherIsBetter: false }
  ];
  if (room) {
    rows.push({ id: `room-level-${key}`, label: `Room sound under the voice (after the ${of})`, unit: 'dBFS', ...each(room, grid => speechLevel(grid, frames)), higherIsBetter: false });
    // In the pause tails the early reflections have passed, so the reference point no longer matters: one row.
    if (first) rows.push({ id: 'tail-level', label: 'Reverb in pause tails (50 to 300 ms after the voice stops)', unit: 'dBFS', ...each(room, grid => tailLevel(grid, frames)), higherIsBetter: false });
  }
  if (key === 'mix') {
    rows.push({ id: 'tail-level-mix', label: 'Level 50 to 300 ms after speech stops (whole mix)', unit: 'dBFS', ...each(voice, grid => tailLevel(grid, frames)), note: 'Not a room measure: a dry voice over music shows the same drop as a reverberant one' });
  }
  return rows;
}

/** What is not voice in a mix without a room (music, effects), followed through the effect. */
function bedRows(material: Material, result: EffectResult, frames: Frames): MetricRow[] {
  if (!material.voice || material.room || !result.follow) return [];
  const bed = minus(material.mix, material.voice);
  const pair = grids({ before: bed, after: result.follow(bed) });
  // A dry voice alone has nothing under it.
  if (speechLevel(pair.before, frames) < speechLevel(powerGrid(material.voice), frames) - 80) return [];
  const pause = Uint8Array.from(frames.speech, value => 1 - value);
  const level = (mask: Uint8Array) => each(pair, grid => maskedLevel(framePower(grid, voiceBand(grid)), mask));
  return [
    { id: 'bed-level-speech', label: 'Other sound while the voice speaks', unit: 'dBFS', ...level(frames.speech) },
    { id: 'bed-level-pauses', label: 'Other sound in pauses', unit: 'dBFS', ...level(pause), note: 'A gap to the level while speaking is the voice pumping the sound under it' }
  ];
}

/** Every version of the unprocessed voice the material knows: one per reference point, or the dry voice. */
function voiceReferences({ room, voice }: Material): { key: string; of: string; signal: Signal }[] {
  if (room) return REFERENCE_POINTS.map((point, index) => ({ key: point.key, of: point.label, signal: sum(room.parts.slice(0, index + 1)) }));
  return voice ? [{ key: 'direct', of: 'dry voice', signal: voice }] : [];
}

/** Intelligibility of the mix against each known version of the voice (left channel). */
function estoiRows(material: Material, output: Signal): MetricRow[] {
  const { mix } = material;
  const references = voiceReferences(material);
  return references.map(({ key, of, signal }) => ({
    id: `estoi-${key}`,
    label: `ESTOI against the ${of}`,
    unit: '0 to 1',
    before: estoi(signal.channels[0], mix.channels[0], mix.sampleRate),
    after: estoi(signal.channels[0], output.channels[0], mix.sampleRate),
    higherIsBetter: true
  }));
}

function describe(material: Material, mix: Grid): Frames {
  const { dry } = material;
  const speech = dry ? speechInDryVoice(powerGrid({ sampleRate: material.mix.sampleRate, channels: [dry] })) : speechInMix(mix);
  return describeFrames(speech, mix.frameHz);
}

/**
 * The level rows alone (voice, word endings, level movement, room, tail, other sound): everything
 * the echo regression gate asserts on, without the slower perceptual measures.
 */
export function levelRows(material: Material, result: EffectResult): MetricRow[] {
  const mix = grids({ before: material.mix, after: result.output });
  const frames = describe(material, mix.before);
  return [...views(material, result, mix).flatMap((view, index) => viewRows(view, frames, index === 0)), ...bedRows(material, result, frames)];
}

export function measure(material: Material, result: EffectResult): MetricRow[] {
  const { mix } = material;
  const mixGrids = grids({ before: mix, after: result.output });
  const frames = describe(material, mixGrids.before);
  const all = views(material, result, mixGrids);
  return [
    ...all.flatMap((view, index) => viewRows(view, frames, index === 0)),
    ...bedRows(material, result, frames),
    ...estoiRows(material, result.output),
    ...bandsOf(mixGrids.before).map(band => ({
      id: band.id, label: `${band.label} while speaking (${all[0].of})`, unit: 'dBFS', ...each(all[0].voice, grid => bandLevel(grid, band, frames.speech))
    })),
    {
      id: 'srmr', label: 'SRMR (envelope modulation ratio, whole mix)', unit: 'ratio',
      before: srmr(mix.channels[0], mix.sampleRate), after: srmr(result.output.channels[0], mix.sampleRate),
      note: 'Rises for anything that deepens the gaps between sounds, a gated voice included; not proof of less reverb'
    },
    { id: 'loudness', label: 'Loudness (BS.1770, whole mix)', unit: 'LUFS', before: loudness(mix), after: loudness(result.output) }
  ];
}
