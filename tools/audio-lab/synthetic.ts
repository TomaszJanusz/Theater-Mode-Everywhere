/**
 * Built-in test material that needs no files: a deterministic speech-like voice and frozen
 * synthetic rooms (fixed seeds), so the node regression gate and the metric tests run anywhere.
 * It stands in for speech only as far as the metrics need: words with onsets, sustained voiced
 * sounds with moving formants, weak endings, fricatives and pauses. Real speech lives in the corpus.
 */
import { buildRoom, LAB_RATE, type Material } from './material';

/** Deterministic uniform noise in [0, 1). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

type Syllable = { start: number; fricative: number; voiced: number; fall: number; f0: number; glide: number; formants: [number, number]; level: number };

function plan(seconds: number, next: () => number): Syllable[] {
  const syllables: Syllable[] = [];
  let t = 0.15;
  while (t < seconds - 0.6) {
    const count = 1 + Math.floor(3 * next());
    const f0 = 95 + 80 * next();
    for (let s = 0; s < count; s++) {
      const fricative = next() < 0.4 ? 0.04 + 0.05 * next() : 0;
      const voiced = 0.1 + 0.16 * next();
      const fall = 0.05 + 0.05 * next();
      syllables.push({
        start: t, fricative, voiced, fall, f0: f0 * (0.92 + 0.16 * next()), glide: 0.9 + 0.2 * next(),
        formants: [300 + 500 * next(), 900 + 1400 * next()],
        // Unstressed syllables are up to 10 dB weaker.
        level: 10 ** (-10 * next() * next() / 20)
      });
      t += fricative + voiced + 0.6 * fall;
    }
    t += 0.18 + 0.4 * next();
  }
  return syllables;
}

/** Mono, peak-normalised to 0.5. */
export function syntheticVoice(seconds: number, seed = 11): Float32Array {
  const rate = LAB_RATE;
  const out = new Float64Array(Math.round(seconds * rate));
  const next = random(seed);
  for (const syllable of plan(seconds, next)) {
    const begin = Math.round(syllable.start * rate);
    const frication = Math.round(syllable.fricative * rate);
    let previous = 0;
    for (let i = 0; i < frication && begin + i < out.length; i++) {
      const white = 2 * next() - 1;
      // The difference of white noise leans to high frequencies, like a sibilant.
      out[begin + i] += 0.25 * syllable.level * Math.sin(Math.PI * i / frication) * (white - previous);
      previous = white;
    }
    const start = begin + frication;
    const length = Math.round((syllable.voiced + syllable.fall) * rate);
    const sustain = Math.round(syllable.voiced * rate);
    const rise = Math.round(0.015 * rate);
    const harmonics = Math.floor(5000 / (syllable.f0 * Math.max(1, syllable.glide)));
    const weights = Float64Array.from({ length: harmonics }, (_, h) => {
      const f = (h + 1) * syllable.f0;
      return (1 + 3 * Math.exp(-(((f - syllable.formants[0]) / 180) ** 2)) + 2 * Math.exp(-(((f - syllable.formants[1]) / 350) ** 2))) / (h + 1);
    });
    let phase = 0;
    for (let i = 0; i < length && start + i < out.length; i++) {
      const progress = i / length;
      phase += 2 * Math.PI * syllable.f0 * (1 + (syllable.glide - 1) * progress) / rate;
      let envelope = 1;
      if (i < rise) envelope = 0.5 - 0.5 * Math.cos(Math.PI * i / rise);
      else if (i > sustain) envelope = 0.5 + 0.5 * Math.cos(Math.PI * (i - sustain) / (length - sustain));
      let sum = 0;
      for (let h = 0; h < harmonics; h++) sum += weights[h] * Math.sin((h + 1) * phase + h);
      out[start + i] += syllable.level * envelope * sum;
    }
  }
  const peak = out.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  return Float32Array.from(out, value => 0.5 * value / peak);
}

/** Two-band decaying noise from `from` seconds on: the high band dies sooner, as in real rooms. */
function diffuseTail(length: number, rt60: number, from: number, next: () => number): Float64Array {
  const tail = new Float64Array(length);
  let low = 0;
  for (let i = Math.round(from * LAB_RATE); i < length; i++) {
    const t = i / LAB_RATE;
    const white = 2 * next() - 1;
    low += 0.25 * (white - low);
    tail[i] = low * Math.exp(-3 * Math.LN10 * t / (1.1 * rt60)) + (white - low) * Math.exp(-3 * Math.LN10 * t / (0.75 * rt60));
  }
  return tail;
}

const energy = (values: Float64Array, from = 0) => values.subarray(from).reduce((sum, value) => sum + value * value, 0);

function scaleTo(values: Float64Array, wanted: number): void {
  const factor = Math.sqrt(Math.max(wanted, 1e-9) / energy(values));
  for (let i = 0; i < values.length; i++) values[i] *= factor;
}

/**
 * The room of TME-259/275: direct sound, six early reflections within 45 ms and a diffuse
 * exponential tail from 50 ms, with the direct sound `drrDb` above everything else.
 */
function exponentialRoom(rt60: number, drrDb: number, seed: number): Float64Array {
  const next = random(seed);
  const length = Math.round(Math.min(2.5, 1.6 * rt60 + 0.2) * LAB_RATE);
  const response = new Float64Array(length);
  for (let i = 0; i < 6; i++) response[Math.round((0.004 + 0.041 * next()) * LAB_RATE)] += 0.7 * next() - 0.35;
  const tail = diffuseTail(length, rt60, 0.05, next);
  scaleTo(tail, 10 ** (-drrDb / 10) - energy(response));
  for (let i = 0; i < length; i++) response[i] += tail[i];
  response[0] = 1;
  return response;
}

/**
 * A small untreated room with the microphone away from the mouth: many strong wall reflections in
 * the first 50 ms (together 6 dB above the direct sound) and a short tail carrying only 9 % of the
 * reflected energy. This is the case a 50 ms early/late split hides.
 */
function wallRoom(seed: number): Float64Array {
  const next = random(seed);
  const length = Math.round(0.7 * LAB_RATE);
  const reflections = new Float64Array(length);
  for (let i = 0; i < 28; i++) {
    const t = 0.003 + 0.047 * next();
    reflections[Math.round(t * LAB_RATE)] += (next() < 0.5 ? -1 : 1) * (0.3 + 0.7 * next()) * Math.exp(-t / 0.03);
  }
  const reflected = 10 ** 0.6;
  scaleTo(reflections, 0.91 * reflected);
  const tail = diffuseTail(length, 0.3, 0.05, next);
  scaleTo(tail, 0.09 * reflected);
  const response = Float64Array.from(reflections, (value, i) => value + tail[i]);
  response[0] = 1;
  return response;
}

const ROOMS: Record<string, { label: string; response?: (channel: number) => Float64Array }> = {
  'synthetic-dry': { label: 'Synthetic voice, no room' },
  'synthetic-wall': { label: 'Synthetic voice, wall reflections (91 % of reflected energy within 50 ms)', response: channel => wallRoom(700 + channel) },
  'synthetic-room-0.3s': { label: 'Synthetic voice, room RT60 0.3 s, DRR +4 dB', response: channel => exponentialRoom(0.3, 4, 30 + channel) },
  'synthetic-room-0.8s': { label: 'Synthetic voice, room RT60 0.8 s, DRR 0 dB', response: channel => exponentialRoom(0.8, 0, 80 + channel) },
  'synthetic-room-1.5s': { label: 'Synthetic voice, room RT60 1.5 s, DRR -4 dB', response: channel => exponentialRoom(1.5, -4, 150 + channel) }
};

export const SYNTHETIC_IDS = Object.keys(ROOMS);

export function syntheticMaterial(id: string, seconds = 8): Material {
  const room = ROOMS[id];
  if (!room) throw new Error(`Unknown synthetic material '${id}'. Known: ${SYNTHETIC_IDS.join(', ')}`);
  const dry = syntheticVoice(seconds);
  if (!room.response) {
    const voice = { sampleRate: LAB_RATE, channels: [dry, dry.slice()] };
    return { id, label: room.label, mix: voice, dry, voice };
  }
  return { id, label: room.label, dry, ...buildRoom(dry, [room.response(0), room.response(1)], 0) };
}
