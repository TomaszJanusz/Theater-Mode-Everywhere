/**
 * Turns one run into metric rows. Each definition lives in its own file under `metrics/`; this
 * module only decides which signal each metric is taken on:
 *
 * - With a known room and an effect that can be followed, the voice and the room's sound are
 *   measured separately at every reference point of `metrics/early-late.ts`.
 * - With a known dry voice over other sound, the voice and that other sound are measured.
 * - Otherwise only the whole mix is known, and the rows say so (`-mix`).
 *
 * ESTOI and SRMR hear one channel at a time. They are taken per channel and averaged over the
 * channels that yield a score, so a clip with sound on one side only is judged by that side.
 */
import type { EffectResult } from './effects';
import type { Material } from './material';
import { bandLevel, bandsOf } from './metrics/band-energy';
import { REFERENCE_POINTS, type ReferenceKey } from './metrics/early-late';
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

/** The reference point behind which the room's sound counts as late reverb. */
const LATE_CUT: ReferenceKey = '50ms';

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

function viewRows({ key, of, voice, room, note }: View, frames: Frames): MetricRow[] {
  const rows: MetricRow[] = [
    { id: `voice-level-${key}`, label: `${key === 'mix' ? 'Level' : 'Voice level'} while speaking (${of})`, unit: 'dBFS', ...each(voice, grid => voiceLevel(grid, frames)), higherIsBetter: true, note },
    { id: `word-ending-level-${key}`, label: `Speech in the last 60 ms before a pause (${of})`, unit: 'dBFS', ...each(voice, grid => wordEndingLevel(grid, frames)), higherIsBetter: true },
    { id: `level-movement-${key}`, label: `Level movement while speaking (${of})`, unit: 'dB', before: 0, after: levelMovement(voice.before, voice.after, frames), higherIsBetter: false }
  ];
  if (room) {
    rows.push({ id: `room-level-${key}`, label: `Room sound under the voice (after the ${of})`, unit: 'dBFS', ...each(room, grid => speechLevel(grid, frames)), higherIsBetter: false });
    // The tail is the late reverb: early reflections are kept out by the cut, not only by the window.
    if (key === LATE_CUT) rows.push({ id: 'tail-level', label: `Late reverb in pause tails (after the ${of}; 50 to 300 ms after the voice stops)`, unit: 'dBFS', ...each(room, grid => tailLevel(grid, frames)), higherIsBetter: false });
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

/** A per-channel score averaged over the channels that have one; NaN when none does. */
function channelMean(channels: number[], score: (channel: number) => number): number {
  const scores = channels.map(score).filter(value => !Number.isNaN(value));
  return scores.length === 0 ? Number.NaN : scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

/** Every channel, or only the first when they all carry the same samples (mono material costs one pass). */
function distinctChannels(...signals: Signal[]): number[] {
  const same = signals.every(({ channels }) => channels.every(channel => channel.every((value, i) => value === channels[0][i])));
  return same ? [0] : signals[0].channels.map((_, channel) => channel);
}

/** Intelligibility of the mix against each known version of the voice. */
function estoiRows(material: Material, output: Signal): MetricRow[] {
  const { mix } = material;
  return voiceReferences(material).map(({ key, of, signal }) => {
    const channels = distinctChannels(signal, mix, output);
    const against = (test: Signal) => channelMean(channels, channel => estoi(signal.channels[channel], test.channels[channel], mix.sampleRate));
    return { id: `estoi-${key}`, label: `ESTOI against the ${of}`, unit: '', before: against(mix), after: against(output), higherIsBetter: true };
  });
}

function srmrRow(mix: Signal, output: Signal): MetricRow {
  const channels = distinctChannels(mix, output);
  const of = (signal: Signal) => channelMean(channels, channel => srmr(signal.channels[channel], signal.sampleRate));
  return {
    id: 'srmr', label: 'SRMR (envelope modulation ratio, whole mix)', unit: 'ratio', before: of(mix), after: of(output),
    note: 'Rises for anything that deepens the gaps between sounds, a gated voice included; not proof of less reverb'
  };
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
  return [...views(material, result, mix).flatMap(view => viewRows(view, frames)), ...bedRows(material, result, frames)];
}

export function measure(material: Material, result: EffectResult): MetricRow[] {
  const { mix } = material;
  const mixGrids = grids({ before: mix, after: result.output });
  const frames = describe(material, mixGrids.before);
  const all = views(material, result, mixGrids);
  return [
    ...all.flatMap(view => viewRows(view, frames)),
    ...bedRows(material, result, frames),
    ...estoiRows(material, result.output),
    ...bandsOf(mixGrids.before).map(band => ({
      id: band.id, label: `${band.label} while speaking (${all[0].of})`, unit: 'dBFS', ...each(all[0].voice, grid => bandLevel(grid, band, frames.speech))
    })),
    srmrRow(mix, result.output),
    { id: 'loudness', label: 'Loudness (BS.1770, whole mix)', unit: 'LUFS', before: loudness(mix), after: loudness(result.output) }
  ];
}
