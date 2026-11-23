/**
 * Test material as the lab sees it: the mix an effect hears, and, when they are known, the parts
 * it was made from. Known parts are what let a metric speak about "the voice" or "the reverb"
 * instead of about the whole mix. Everything is 48 kHz stereo: the echo DSP's 1024-sample frame
 * is only what ships at playback rates, so slower material is resampled before any effect runs.
 */
import { firstArrival, leadOf, reflectionShares, splitResponse, type ReferenceKey } from './metrics/early-late';
import { convolveAll } from './metrics/fft';
import type { Signal } from './types';

export const LAB_RATE = 48000;

export type Room = {
  /**
   * The voice in the room, cut where `splitResponse` cuts the room's response: the direct sound,
   * then what arrives up to 10, 20 and 50 ms, then the rest. The parts add up to the mix.
   */
  parts: Signal[];
  /** Share of the reflected energy that arrives before each reference point. */
  shares: Record<ReferenceKey, number>;
};

export type Material = {
  id: string;
  label: string;
  mix: Signal;
  /** The talker without room or accompaniment, aligned with the mix; frame labels come from it. */
  dry?: Float32Array;
  room?: Room;
  /** The voice as it sits in a mix that has no room (speech over music): the rest is not voice. */
  voice?: Signal;
  /** The sound in the mix that is not the talker (music, effects), aligned with it. A mix with a `voice` and no `bed` takes all that is not the voice as its bed. */
  bed?: Signal;
};

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
export const sum = (signals: Signal[]): Signal => combine(signals[0], signals.slice(1), 1);
export const minus = (a: Signal, b: Signal): Signal => combine(a, [b], -1);

/**
 * The dry voice convolved with each part of the room's response (one or two channels), peak 0.5,
 * on the dry voice's timeline: the direct sound sits where the dry voice does. `arrival` is the
 * sample of the response at which the direct sound arrives; without it the lab looks for it.
 */
export function buildRoom(dry: Float32Array, response: Float64Array[], arrival = firstArrival(response, LAB_RATE)): { mix: Signal; room: Room } {
  const split = splitResponse(response, LAB_RATE, arrival);
  // The parts keep the direct sound's rise, which would delay them against the dry voice by as much.
  const lead = leadOf(arrival, LAB_RATE);
  const kernels = [0, 1].flatMap(channel => split.map(part => part[Math.min(channel, response.length - 1)]));
  const padded = new Float32Array(dry.length + lead);
  padded.set(dry);
  const convolved = convolveAll(padded, kernels).map(part => part.subarray(lead));
  const mix = [new Float64Array(dry.length), new Float64Array(dry.length)];
  let peak = 0;
  for (const [index, part] of convolved.entries()) {
    const channel = mix[index < split.length ? 0 : 1];
    for (let i = 0; i < part.length; i++) channel[i] += part[i];
  }
  for (const channel of mix) for (let i = 0; i < channel.length; i++) peak = Math.max(peak, Math.abs(channel[i]));
  const scaled = (values: Float64Array) => {
    const out = new Float32Array(values.length);
    for (let i = 0; i < values.length; i++) out[i] = 0.5 * values[i] / peak;
    return out;
  };
  return {
    mix: { sampleRate: LAB_RATE, channels: mix.map(scaled) },
    room: {
      parts: split.map((_, part) => ({ sampleRate: LAB_RATE, channels: [scaled(convolved[part]), scaled(convolved[split.length + part])] })),
      shares: reflectionShares(split)
    }
  };
}
