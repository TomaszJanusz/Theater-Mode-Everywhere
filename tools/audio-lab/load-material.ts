/** Finds test material by id: built-in synthetic rooms, the corpus manifest, or a WAV file. */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRoom, LAB_RATE, type Material } from './material';
import { resample } from './metrics/resample';
import { SYNTHETIC_IDS, syntheticMaterial } from './synthetic';
import type { Signal } from './types';
import { readWav } from './wav';

const CORPUS = resolve(fileURLToPath(import.meta.url), '../corpus');
type Corpus = { entries: Entry[]; directory: string };
const cacheDir = () => join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'theater-everywhere', 'audio-lab');

const atLabRate = (signal: Signal): Float64Array[] => signal.channels.map(channel => resample(channel, signal.sampleRate, LAB_RATE));

function toStereo(signal: Signal): Signal {
  const channels = atLabRate(signal).slice(0, 2).map(channel => Float32Array.from(channel));
  return { sampleRate: LAB_RATE, channels: channels.length === 1 ? [channels[0], channels[0].slice()] : channels };
}

function toMono(signal: Signal): Float32Array {
  const channels = atLabRate(signal);
  return Float32Array.from(channels[0], (_, i) => channels.reduce((sum, channel) => sum + channel[i], 0) / channels.length);
}

/** The dry voice as it sits in each channel of a mix: its least-squares gain, the rest being uncorrelated. */
function voiceInMix(mix: Signal, dry: Float32Array): Signal {
  const own = dry.reduce((sum, value) => sum + value * value, 0);
  return {
    sampleRate: mix.sampleRate,
    channels: mix.channels.map(channel => {
      let cross = 0;
      for (let i = 0; i < Math.min(channel.length, dry.length); i++) cross += channel[i] * dry[i];
      return Float32Array.from(channel, (_, i) => (cross / own) * (dry[i] ?? 0));
    })
  };
}

/**
 * What the lab reads from a corpus manifest entry; the corpus owns the file and its other fields.
 * `dry` and `impulseResponse` name other entries. An entry of kind `speech` is its own dry voice.
 */
type Entry = { id: string; kind?: string; label?: string; file?: string; dry?: string; impulseResponse?: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function readManifest(directory: string): Entry[] {
  const path = join(directory, 'manifest.json');
  if (!existsSync(path)) return [];
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const entries = isRecord(parsed) ? parsed.entries : undefined;
  if (!Array.isArray(entries)) throw new Error(`${path}: expected { "entries": [...] }`);
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
  return entries.map((entry: unknown) => {
    const id = isRecord(entry) ? text(entry.id) : undefined;
    if (!isRecord(entry) || !id) throw new Error(`${path}: an entry has no id`);
    return { id, kind: text(entry.kind), label: text(entry.label), file: text(entry.file), dry: text(entry.dry), impulseResponse: text(entry.impulseResponse) };
  });
}

/** Committed clips sit in the corpus directory; fetched third-party clips in the user's cache, by id. */
function entryAudio(entry: Entry, directory: string): Signal {
  const committed = entry.file ? join(directory, entry.file) : null;
  if (committed && existsSync(committed)) return readWav(committed);
  const cached = join(cacheDir(), `${entry.id}.wav`);
  if (existsSync(cached)) return readWav(cached);
  const places = committed ? `${committed} or ${cached}` : cached;
  throw new Error(`Material '${entry.id}' has no audio at ${places}; fetch the corpus first.`);
}

function fromManifest(entry: Entry, { entries, directory }: Corpus): Material {
  const audioOf = (id: string) => {
    const found = entries.find(other => other.id === id);
    if (!found) throw new Error(`Material '${entry.id}' refers to '${id}', which the manifest does not list`);
    return entryAudio(found, directory);
  };
  const label = entry.label ?? entry.id;
  const dryId = entry.dry ?? (entry.kind === 'speech' ? entry.id : undefined);
  const dry = dryId ? toMono(audioOf(dryId)) : undefined;
  if (dry && entry.impulseResponse) {
    return { id: entry.id, label, dry, ...buildRoom(dry, atLabRate(audioOf(entry.impulseResponse)), LAB_RATE) };
  }
  const mix = toStereo(entryAudio(entry, directory));
  return { id: entry.id, label, mix, dry, voice: dry ? voiceInMix(mix, dry) : undefined };
}

/** Resolves a built-in synthetic id, then a corpus manifest id, then a path to a WAV file. */
export function loadMaterial(id: string, directory = CORPUS): Material {
  if (SYNTHETIC_IDS.includes(id)) return syntheticMaterial(id);
  const entries = readManifest(directory);
  const entry = entries.find(candidate => candidate.id === id);
  if (entry) return fromManifest(entry, { entries, directory });
  if (existsSync(id)) return { id, label: basename(id), mix: toStereo(readWav(id)) };
  const known = [...SYNTHETIC_IDS, ...entries.map(candidate => candidate.id)].join(', ');
  throw new Error(`Unknown material '${id}': not a material id (${known}) and not a WAV file (looked in ${dirname(resolve(id))})`);
}
