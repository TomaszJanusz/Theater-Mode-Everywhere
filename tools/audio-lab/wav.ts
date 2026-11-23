/** RIFF WAVE in and out, enough for test material: PCM 16/24/32-bit and 32-bit float, any channel count. */
import { readFileSync, writeFileSync } from 'node:fs';

import type { Signal } from './types';

const PCM = 1;
const FLOAT = 3;
const EXTENSIBLE = 0xfffe;

type Format = { tag: number; channels: number; sampleRate: number; bits: number };

function readFormat(view: DataView, at: number): Format {
  const tag = view.getUint16(at, true);
  return {
    // An extensible header keeps the real format in the first two bytes of its sub-format GUID.
    tag: tag === EXTENSIBLE ? view.getUint16(at + 24, true) : tag,
    channels: view.getUint16(at + 2, true),
    sampleRate: view.getUint32(at + 4, true),
    bits: view.getUint16(at + 14, true)
  };
}

function sampleReader(view: DataView, { tag, bits }: Format): (at: number) => number {
  if (tag === FLOAT && bits === 32) return at => view.getFloat32(at, true);
  if (tag === PCM && bits === 16) return at => view.getInt16(at, true) / 32768;
  if (tag === PCM && bits === 24) return at => ((view.getInt8(at + 2) << 16) | view.getUint16(at, true)) / 8388608;
  if (tag === PCM && bits === 32) return at => view.getInt32(at, true) / 2147483648;
  throw new Error(`Unsupported WAV encoding: format ${tag}, ${bits} bits`);
}

function readSamples(view: DataView, format: Format, at: number, size: number): Signal {
  if (format.channels < 1) throw new Error('WAV format chunk declares no channels');
  const read = sampleReader(view, format);
  const step = format.bits / 8;
  const frames = Math.floor(Math.min(size, view.byteLength - at) / (step * format.channels));
  const channels = Array.from({ length: format.channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < format.channels; c++) channels[c][i] = read(at + (i * format.channels + c) * step);
  }
  return { sampleRate: format.sampleRate, channels };
}

export function decodeWav(bytes: Uint8Array): Signal {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12 || text(0) !== 'RIFF' || text(8) !== 'WAVE') throw new Error('Not a RIFF WAVE file');
  let format: Format | null = null;
  for (let at = 12; at + 8 <= bytes.length;) {
    const size = view.getUint32(at + 4, true);
    if (text(at) === 'fmt ') format = readFormat(view, at + 8);
    if (text(at) === 'data') {
      if (!format) throw new Error('WAV data chunk comes before its format chunk');
      return readSamples(view, format, at + 8, size);
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('WAV file has no data chunk');
}

/** 16-bit PCM; samples beyond full scale are clipped. */
export function encodeWav(signal: Signal): Uint8Array {
  const channels = signal.channels.length;
  const frames = signal.channels[0].length;
  const bytes = new Uint8Array(44 + frames * channels * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => { for (let i = 0; i < 4; i++) bytes[at + i] = value.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, PCM, true); view.setUint16(22, channels, true);
  view.setUint32(24, signal.sampleRate, true); view.setUint32(28, signal.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, frames * channels * 2, true);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const value = Math.max(-1, Math.min(1, signal.channels[c][i]));
      view.setInt16(44 + (i * channels + c) * 2, Math.round(value * 32767), true);
    }
  }
  return bytes;
}

export const readWav = (path: string): Signal => decodeWav(readFileSync(path));
export const writeWav = (path: string, signal: Signal): void => writeFileSync(path, encodeWav(signal));
