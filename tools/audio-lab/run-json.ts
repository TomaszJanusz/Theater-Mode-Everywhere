import type { LabRun, MetricRow, Signal } from './types';

function encodeSignal(signal: Signal) {
  return {
    sampleRate: signal.sampleRate,
    channels: signal.channels.map((channel) => {
      const bytes = Buffer.allocUnsafe(channel.length * 4);
      for (let i = 0; i < channel.length; i++) bytes.writeFloatLE(channel[i], i * 4);
      return bytes.toString('base64');
    }),
  };
}

/** JSON transports the audio as portable little-endian float32, without lossy PCM conversion. */
export function encodeRun(run: LabRun): string {
  return JSON.stringify({ ...run, input: encodeSignal(run.input), output: encodeSignal(run.output) });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function channelSamples(value: unknown): Float32Array {
  if (Array.isArray(value) && value.every(finite)) return Float32Array.from(value);
  if (typeof value !== 'string') throw new Error('Expected a base64 float32 channel or a numeric array');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length % 4 !== 0 || bytes.toString('base64') !== value) throw new Error('Invalid base64 float32 channel');
  return Float32Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(i * 4));
}

function decodeSignal(value: unknown, name: string): Signal {
  if (!record(value) || !finite(value.sampleRate) || !Number.isInteger(value.sampleRate) ||
      value.sampleRate < 1000 || value.sampleRate > 384000 || !Array.isArray(value.channels) ||
      value.channels.length < 1 || value.channels.length > 2) {
    throw new Error(`${name}: expected a sample rate and one or two channels`);
  }
  const channels = value.channels.map(channelSamples);
  const length = channels[0].length;
  if (length === 0 || channels.some((channel) => channel.length !== length || !channel.every(Number.isFinite))) {
    throw new Error(`${name}: expected equal-length channels with finite samples`);
  }
  return { sampleRate: value.sampleRate, channels };
}

function metricValue(value: unknown): number {
  if (value === null) return NaN;
  if (!finite(value)) throw new Error('Metric values must be finite numbers or null');
  return value;
}

function decodeMetric(value: unknown): MetricRow {
  if (!record(value) || typeof value.id !== 'string' || typeof value.label !== 'string' || typeof value.unit !== 'string' ||
      (value.higherIsBetter !== undefined && typeof value.higherIsBetter !== 'boolean') ||
      (value.note !== undefined && typeof value.note !== 'string')) {
    throw new Error('Invalid metric row');
  }
  return {
    id: value.id, label: value.label, unit: value.unit, before: metricValue(value.before), after: metricValue(value.after),
    higherIsBetter: value.higherIsBetter, note: value.note,
  };
}

export function decodeRun(text: string): LabRun {
  const value: unknown = JSON.parse(text);
  if (!record(value) || typeof value.effect !== 'string' || typeof value.material !== 'string' || !Array.isArray(value.metrics)) {
    throw new Error('Expected LabRun JSON from audio:lab --json');
  }
  const input = decodeSignal(value.input, 'input');
  const output = decodeSignal(value.output, 'output');
  if (input.sampleRate !== output.sampleRate || input.channels[0].length !== output.channels[0].length ||
      input.channels.length !== output.channels.length) {
    throw new Error('Input and output must share a timeline, sample rate and channel count');
  }
  return { effect: value.effect, material: value.material, input, output, metrics: value.metrics.map(decodeMetric) };
}
