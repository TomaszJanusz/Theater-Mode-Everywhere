/**
 * Test material as the lab sees it: the mix an effect hears, and, when they are known, the parts
 * it was made from. Known parts are what let a metric speak about "the voice" or "the reverb"
 * instead of about the whole mix. Everything is 48 kHz stereo: the echo DSP's 1024-sample frame
 * is only what ships at playback rates, so slower material is resampled before any effect runs.
 */
import { reflectionShares, splitResponse, type ReferenceKey } from './metrics/early-late';
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
};

/** The dry voice convolved with each part of the room's response (one or two channels), peak 0.5. */
export function buildRoom(dry: Float32Array, response: Float64Array[], sampleRate: number): { mix: Signal; room: Room } {
  const split = splitResponse(response, sampleRate);
  const kernels = [0, 1].flatMap(channel => split.map(part => part[Math.min(channel, response.length - 1)]));
  const convolved = convolveAll(dry, kernels);
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
    mix: { sampleRate, channels: mix.map(scaled) },
    room: {
      parts: split.map((_, part) => ({ sampleRate, channels: [scaled(convolved[part]), scaled(convolved[split.length + part])] })),
      shares: reflectionShares(response, sampleRate)
    }
  };
}
