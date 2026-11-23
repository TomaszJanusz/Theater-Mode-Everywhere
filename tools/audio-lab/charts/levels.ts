import { amplitudeDb } from '../../audio-charts/plot';
import type { Signal } from '../types';

type PeakRange = { min: number; max: number };
type TimeRange = { start: number; end: number };
export const TAIL_SECONDS = 1.5;
export const TAIL_WINDOW = 0.02;

/** Keep both extremes across all channels so narrow peaks and out-of-phase stereo survive downsampling. */
export function envelope(signal: Signal, columns: number): PeakRange[] {
  const length = signal.channels[0].length;
  const bins = Math.min(columns, length);
  return Array.from({ length: bins }, (_, col) => {
    const from = Math.floor(col * length / bins);
    const to = Math.floor((col + 1) * length / bins);
    let min = Infinity;
    let max = -Infinity;
    for (const channel of signal.channels) {
      for (let sample = from; sample < to; sample++) {
        min = Math.min(min, channel[sample]);
        max = Math.max(max, channel[sample]);
      }
    }
    return { min, max };
  });
}

function measure(signal: Signal, from = 0, to = signal.channels[0].length): { rms: number; peak: number } {
  let sum = 0;
  let peak = 0;
  for (const channel of signal.channels) {
    for (let i = from; i < to; i++) {
      sum += channel[i] ** 2;
      peak = Math.max(peak, Math.abs(channel[i]));
    }
  }
  return { rms: Math.sqrt(sum / ((to - from) * signal.channels.length)), peak };
}

export function tailLevels(signal: Signal, range: TimeRange): { time: number; db: number }[] {
  const from = Math.round(range.start * signal.sampleRate);
  const to = Math.round(range.end * signal.sampleRate);
  const points = [];
  const window = Math.max(1, Math.round(TAIL_WINDOW * signal.sampleRate));
  for (let start = from; start < to; start += window) {
    const end = Math.min(start + window, to);
    points.push({
      time: (start + end) / (2 * signal.sampleRate),
      db: amplitudeDb(measure(signal, start, end).rms),
    });
  }
  return points;
}

/** Whole-excerpt channel-average RMS. Match downward with 1 dB of sample-peak headroom.
 * A silent side cannot be matched, so keep it silent and only cap the other side's peak. */
export function listeningGains(input: Signal, output: Signal): [number, number] {
  const before = measure(input);
  const after = measure(output);
  const ceiling = 10 ** (-1 / 20);
  if (before.rms === 0 || after.rms === 0) {
    return [Math.min(1, ceiling / before.peak), Math.min(1, ceiling / after.peak)];
  }
  const target = Math.min(before.rms, after.rms, ceiling * before.rms / before.peak, ceiling * after.rms / after.peak);
  return [target / before.rms, target / after.rms];
}

export function listeningWav(signal: Signal, gain: number): string {
  const channels = signal.channels.length;
  const length = signal.channels[0].length;
  const blockAlign = channels * 2;
  const dataSize = length * blockAlign;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(signal.sampleRate, 24);
  wav.writeUInt32LE(signal.sampleRate * blockAlign, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (const channel of signal.channels) {
      wav.writeInt16LE(Math.round(channel[i] * gain * 32768), offset);
      offset += 2;
    }
  }
  return `data:audio/wav;base64,${wav.toString('base64')}`;
}
