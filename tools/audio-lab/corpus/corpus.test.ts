import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { it } from 'node:test';

import manifest from './manifest.json';

const directory = new URL('./', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, directory));
const entries = manifest.entries.filter(({ kind }) => kind !== 'external');

it('freezes the corpus with one verified entry per committed audio file and stays under budget', () => {
  assert.deepEqual(entries.map(({ file }) => file).sort(), readdirSync(directory).filter((file) => file.endsWith('.wav')).sort());
  const ids = manifest.entries.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  let size = 0;
  for (const entry of entries) {
    const wav = read(entry.file);
    assert.equal(createHash('sha256').update(wav).digest('hex'), entry.sha256, entry.id);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 36, 40), 'data');
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.readUInt32LE(24), 16000);
    assert.equal(wav.readUInt32LE(40) / wav.readUInt32LE(28), entry.duration, entry.id);
    size += wav.length;
  }
  assert.equal(size, manifest.committedAudioBytes);
  assert.ok(size <= manifest.committedAudioLimitBytes && manifest.committedAudioLimitBytes === 1_500_000);
  for (const entry of manifest.entries.filter(({ kind }) => kind === 'external')) {
    assert.equal(entry.cache, true);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.equal(existsSync(new URL(entry.file, directory)), false);
  }
});

it('keeps the dry reference aligned and includes a dominant later wall reflection', () => {
  const dry = read('dry-speech.wav');
  const rooms = entries.filter(({ kind }) => kind === 'room');
  assert.deepEqual(rooms.map(({ nominalRt60 }) => nominalRt60), [0.3, 0.8, 1.5, 0.8]);
  for (const room of rooms) {
    assert.equal(room.dry, 'dry-speech');
    assert.ok(entries.find(({ id, kind }) => id === room.impulseResponse && kind === 'impulse-response'));
    assert.equal(read(room.file).length, dry.length);
  }
  const wall = read('wall-reflection-ir.wav');
  const direct = wall.readInt16LE(44);
  const delayed = wall.readInt16LE(44 + Math.round(0.042 * 16000) * 2);
  assert.ok(direct > 0 && delayed > 3 * direct);
});
