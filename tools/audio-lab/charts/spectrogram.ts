import { crc32, deflateSync } from 'node:zlib';

import { amplitudeDb } from '../../audio-charts/plot';
import type { Signal } from '../types';

export const DB_MIN = -90;
export const DB_MAX = 0;
const MAX_COLUMNS = 720;
const ROWS = 120;

export type SpectrumLayout = {
  size: number;
  columns: number;
  rows: number;
  sampleRate: number;
  minHz: number;
  maxHz: number;
};

/** A single layout for both sides. Roughly 43–85 ms windows with 50% overlap. */
export function spectrumLayout(signal: Signal): SpectrumLayout {
  const { sampleRate, channels } = signal;
  const size = Math.max(128, 2 ** Math.ceil(Math.log2(sampleRate * 0.042)));
  return {
    size, sampleRate, rows: ROWS,
    columns: Math.min(MAX_COLUMNS, Math.ceil(channels[0].length / (size / 2))),
    minHz: Math.max(20, sampleRate / size),
    maxHz: sampleRate / 2,
  };
}

function fft(size: number) {
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  const reverse = new Uint32Array(size);
  const cos = new Float64Array(size / 2);
  const sin = new Float64Array(size / 2);
  for (let i = 1; i < size; i++) reverse[i] = (reverse[i >> 1] >> 1) | ((i & 1) * (size / 2));
  for (let i = 0; i < cos.length; i++) {
    cos[i] = Math.cos(-2 * Math.PI * i / size);
    sin[i] = Math.sin(-2 * Math.PI * i / size);
  }
  const hann = Float64Array.from(real, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size));

  return (channel: Float32Array, from: number, power: Float64Array): void => {
    imag.fill(0);
    for (let i = 0; i < size; i++) real[reverse[i]] = (channel[from + i] ?? 0) * hann[i];
    for (let width = 2; width <= size; width *= 2) {
      const half = width / 2;
      for (let from = 0; from < size; from += width) {
        for (let offset = 0; offset < half; offset++) {
          const a = from + offset;
          const b = a + half;
          const t = offset * (size / width);
          const re = real[b] * cos[t] - imag[b] * sin[t];
          const im = real[b] * sin[t] + imag[b] * cos[t];
          real[b] = real[a] - re;
          imag[b] = imag[a] - im;
          real[a] += re;
          imag[a] += im;
        }
      }
    }
    for (let i = 1; i < power.length; i++) {
      // Hann coherent gain is 0.5. Double interior positive-frequency bins
      // for the one-sided spectrum and leave Nyquist single-sided.
      const scale = (i === size / 2 ? 2 : 4) / size;
      power[i] += (real[i] ** 2 + imag[i] ** 2) * scale ** 2;
    }
  };
}

function rowBins(layout: SpectrumLayout): Array<[number, number]> {
  const { size, sampleRate, rows, minHz, maxHz } = layout;
  const binAt = (edge: number) => maxHz * (minHz / maxHz) ** (edge / rows) * size / sampleRate;
  return Array.from({ length: rows }, (_, row) => [
    Math.max(1, Math.ceil(binAt(row + 1))),
    Math.min(size / 2, Math.max(Math.ceil(binAt(row + 1)), Math.floor(binAt(row)))),
  ]);
}

/** Max-hold within each time/frequency pixel, after averaging channel powers.
 * Time bins share their grid with the waveform. Long clips retain brief transients. */
export function spectrogram(signal: Signal, layout: SpectrumLayout): Float32Array {
  const { size, columns, rows } = layout;
  const output = new Float32Array(rows * columns).fill(DB_MIN);
  const length = signal.channels[0].length;
  const frames = Math.ceil(length / (size / 2));
  const transform = fft(size);
  const power = new Float64Array(size / 2 + 1);
  const bins = rowBins(layout);
  for (let frame = 0; frame < frames; frame++) {
    const col = Math.min(columns - 1, Math.floor((frame + 0.5) * columns / frames));
    const center = Math.floor((frame + 0.5) * length / frames);
    power.fill(0);
    for (const channel of signal.channels) transform(channel, center - size / 2, power);
    for (let row = 0; row < rows; row++) {
      const [start, end] = bins[row];
      let max = 0;
      for (let bin = start; bin <= end; bin++) max = Math.max(max, power[bin]);
      const cell = row * columns + col;
      output[cell] = Math.max(output[cell], amplitudeDb(Math.sqrt(max / signal.channels.length), DB_MIN));
    }
  }
  return output;
}

// A single, ordered luminance ramp on a fixed color scale, independent of page theme.
export const SPECTRUM_COLORS = ['#121321', '#2b2451', '#553565', '#8f4762', '#bf6652', '#e4a45b', '#fff0af'];
const RGB = SPECTRUM_COLORS.map((hex) => Buffer.from(hex.slice(1), 'hex'));

export function spectrumColor(db: number): [number, number, number] {
  const position = Math.max(0, Math.min(1, (db - DB_MIN) / (DB_MAX - DB_MIN))) * (RGB.length - 1);
  const index = Math.min(RGB.length - 2, Math.floor(position));
  const blend = position - index;
  const interpolate = (channel: number) => Math.round(RGB[index][channel] * (1 - blend) + RGB[index + 1][channel] * blend);
  return [interpolate(0), interpolate(1), interpolate(2)];
}

function pngChunk(name: string, data: Buffer): Buffer {
  const chunk = Buffer.allocUnsafe(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(name, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}

/** Embed a small RGB raster in the SVG; axes, labels and legend remain vector text. */
export function spectrumImage(values: Float32Array, layout: SpectrumLayout): string {
  const { columns, rows } = layout;
  const lineLength = 1 + 3 * columns;
  const pixels = Buffer.alloc(rows * lineLength); // PNG filter 0 at the start of each scanline.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const [r, g, b] = spectrumColor(values[row * columns + col]);
      const index = row * lineLength + 1 + 3 * col;
      pixels[index] = r;
      pixels[index + 1] = g;
      pixels[index + 2] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(columns, 0);
  header.writeUInt32BE(rows, 4);
  header[8] = 8; // Eight bits per channel.
  header[9] = 2; // RGB.
  const png = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}
