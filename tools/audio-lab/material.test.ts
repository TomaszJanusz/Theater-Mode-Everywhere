import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadMaterial } from './load-material';
import { resample } from './metrics/resample';
import { speechBandLevels } from './metrics/speech-bands';
import { SYNTHETIC_IDS, syntheticMaterial, syntheticVoice } from './synthetic';
import { noise } from './test-utils/signals';
import type { Signal } from './types';
import { readWav, writeWav } from './wav';

const energy = (samples: Float32Array) => samples.reduce((sum, value) => sum + value * value, 0);
const errorDb = (test: Float32Array, reference: Float32Array) => 10 * Math.log10(energy(test.map((value, i) => value - reference[i])) / energy(reference));

describe('audio lab: material', () => {
  const directory = mkdtempSync(join(tmpdir(), 'audio-lab-material-'));
  after(() => rmSync(directory, { recursive: true, force: true }));

  // A corpus as the lab expects it: 16 kHz files, a room built from a dry voice and an impulse response.
  const rate = 16000;
  const dry = syntheticVoice(2).filter((_, i) => i % 3 === 0);
  const response = new Float32Array(1600);
  response[40] = 0.8;
  response[40 + 0.015 * rate] = 0.4;
  response[40 + 0.08 * rate] = -0.3;
  const next = noise(12);
  // Unrelated to the voice: a tone between its harmonics, and noise.
  const music = Float32Array.from(dry, (_, i) => 0.05 * Math.sin(2 * Math.PI * 1234.5 * i / rate) + 0.01 * next());
  const mono = (samples: Float32Array): Signal => ({ sampleRate: rate, channels: [samples] });
  writeWav(join(directory, 'dry.wav'), mono(dry));
  writeWav(join(directory, 'ir.wav'), mono(response));
  writeWav(join(directory, 'music-mix.wav'), { sampleRate: rate, channels: [dry.map((value, i) => 0.5 * value + music[i]), dry.map((value, i) => 0.25 * value - music[i])] });
  // An off-axis talker in front of a wall: the direct sound is weaker than the reflection 42 ms behind it.
  const taps = (direct: number) => {
    const wall = new Float32Array(1600);
    wall[40] = direct;
    wall[40 + 0.042 * rate] = 0.77;
    return wall;
  };
  writeWav(join(directory, 'wall-ir.wav'), mono(taps(0.22)));
  writeWav(join(directory, 'faint-ir.wav'), mono(taps(0.04)));
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({
    entries: [
      { id: 'dry', kind: 'speech', file: 'dry.wav', sha256: 'ignored' },
      { id: 'plain', kind: 'mix', file: 'dry.wav' },
      { id: 'ir', file: 'ir.wav' },
      { id: 'room', file: 'room.wav', dry: 'dry', impulseResponse: 'ir' },
      { id: 'over-music', file: 'music-mix.wav', dry: 'dry' },
      { id: 'wall-ir', file: 'wall-ir.wav' },
      { id: 'wall', file: 'wall.wav', dry: 'dry', impulseResponse: 'wall-ir' },
      { id: 'faint-ir', file: 'faint-ir.wav', directArrivalSample: 40 },
      { id: 'faint', dry: 'dry', impulseResponse: 'faint-ir' },
      { id: 'fetched', cache: true },
      { id: 'broken', file: 'dry.wav', dry: 'missing' },
      { id: 'music-alone', bed: 'over-music' },
      { id: 'room-over-music', dry: 'dry', impulseResponse: 'ir', bed: 'over-music' },
      { id: 'no-bed', bed: 'plain' }
    ]
  }));

  it('builds the built-in rooms the same way every time, parts adding up to the mix', () => {
    assert.deepEqual(SYNTHETIC_IDS, [
      'synthetic-dry', 'synthetic-wall', 'synthetic-room-0.3s', 'synthetic-room-0.8s', 'synthetic-room-1.5s',
      'synthetic-room-0.3s-short-words', 'synthetic-room-0.3s-long-vowels', 'synthetic-room-0.3s-fast', 'synthetic-room-0.3s-fast-pitched',
      'synthetic-music-sustained', 'synthetic-music-plucked', 'synthetic-music-accents', 'synthetic-music-accents-fast', 'synthetic-applause',
      'synthetic-room-0.8s-then-music', 'synthetic-room-0.8s-cut-to-music', 'synthetic-room-0.8s-under-music'
    ]);
    const first = syntheticMaterial('synthetic-room-0.3s', 2);
    const second = syntheticMaterial('synthetic-room-0.3s', 2);
    assert.deepEqual(first.mix.channels[1], second.mix.channels[1]);
    assert.ok(first.room && first.dry);
    assert.equal(first.room.parts.length, 5);
    for (const channel of [0, 1]) {
      const sum = new Float32Array(first.mix.channels[channel].length);
      for (const part of first.room.parts) part.channels[channel].forEach((value, i) => { sum[i] += value; });
      assert.ok(errorDb(sum, first.mix.channels[channel]) < -100);
    }
    const peak = first.mix.channels.reduce((max, channel) => channel.reduce((m, value) => Math.max(m, Math.abs(value)), max), 0);
    assert.ok(Math.abs(peak - 0.5) < 1e-6);
    assert.notDeepEqual(first.mix.channels[0], first.mix.channels[1], 'the two ears hear different reflections');
    assert.throws(() => syntheticMaterial('synthetic-cathedral'), /Unknown synthetic material/);
  });

  it('builds music with no voice in it, below, inside and above the speech bands', () => {
    for (const id of ['synthetic-music-sustained', 'synthetic-music-plucked']) {
      const material = syntheticMaterial(id, 3);
      assert.ok(!material.dry && !material.room && !material.voice && !material.bed, `${id} is only a mix`);
      assert.deepEqual(material.mix.channels[0], syntheticMaterial(id, 3).mix.channels[0], `${id} is the same every time`);
      assert.notDeepEqual(material.mix.channels[0], material.mix.channels[1], `${id} is stereo`);
      const { inside, outside } = speechBandLevels(material.mix);
      assert.ok(inside > -40 && outside > -60, `${id} sounds inside (${inside.toFixed(0)} dBFS) and outside (${outside.toFixed(0)} dBFS) the speech bands`);
    }
    // Sustained music swells in and then holds its level; plucked music falls 20 dB or more between its notes.
    const spread = (id: string) => {
      const [left] = syntheticMaterial(id, 4).mix.channels;
      const levels = Array.from({ length: 30 }, (_, step) => 10 * Math.log10(energy(left.subarray((1 + 0.1 * step) * 48000, (1.02 + 0.1 * step) * 48000))));
      return Math.max(...levels) - Math.min(...levels);
    };
    assert.ok(spread('synthetic-music-sustained') < 6, `sustained: ${spread('synthetic-music-sustained').toFixed(1)} dB`);
    assert.ok(spread('synthetic-music-plucked') > 12, `plucked: ${spread('synthetic-music-plucked').toFixed(1)} dB`);
  });

  it('builds speech an envelope can take for something else: short, long and fast', () => {
    /** The lengths in seconds of the stretches in which the dry voice sounds, with gaps under 30 ms closed. */
    const stretches = (id: string) => {
      const { dry: voice, room } = syntheticMaterial(id, 8);
      assert.ok(voice && room, `${id} is a voice in a room`);
      const lengths: number[] = [];
      let [length, gap] = [0, 0];
      for (let i = 0; i < voice.length; i += 48) {
        const on = Math.abs(voice[i]) > 1e-4 || Math.abs(voice[i + 12] ?? 0) > 1e-4;
        gap = on ? 0 : gap + 1;
        if (on || (length > 0 && gap < 30)) length++;
        else if (length > 0) { lengths.push((length - gap + 1) / 1000); length = 0; }
      }
      return lengths;
    };
    const short = stretches('synthetic-room-0.3s-short-words');
    assert.ok(short.length >= 6 && short.every(length => length > 0.07 && length < 0.1), `words of 90 ms: ${short.join(', ')}`);
    const long = stretches('synthetic-room-0.3s-long-vowels');
    assert.ok(long.length >= 3 && long.every(length => length > 1.1 && length < 1.25), `vowels of 1.2 s: ${long.join(', ')}`);
    // The same phrases 1.6 times as fast: as many again fit into the clip, at the same pitch or a higher one.
    const [plain, fast, pitched] = ['synthetic-room-0.3s', 'synthetic-room-0.3s-fast', 'synthetic-room-0.3s-fast-pitched'].map(id => stretches(id).length);
    assert.ok(fast > 1.3 * plain && pitched > 1.3 * plain, `${plain}, ${fast} and ${pitched} phrases`);
  });

  it('strikes chord accents 8 dB over the music they are played on, and claps without a voice', () => {
    const { mix, bed, dry: voice } = syntheticMaterial('synthetic-music-accents', 6);
    assert.ok(bed && !voice);
    const accents = mix.channels[0].map((value, i) => value - bed.channels[0][i]);
    const during = (samples: Float32Array) => energy(samples.subarray(1.25 * 48000, 1.35 * 48000));
    assert.ok(Math.abs(10 * Math.log10(during(accents) / during(bed.channels[0])) - 8) < 2.5, `${(10 * Math.log10(during(accents) / during(bed.channels[0]))).toFixed(1)} dB in the first accent`);
    assert.ok(energy(accents.subarray(1.5 * 48000, 2.7 * 48000)) < 1e-9, 'and nothing between two accents');
    // Three times as many when they come every half second.
    const fast = syntheticMaterial('synthetic-music-accents-fast', 6);
    assert.ok(fast.bed && energy(fast.mix.channels[0].subarray(1.75 * 48000, 1.85 * 48000).map((value, i) => value - fast.bed!.channels[0][1.75 * 48000 + i])) > 0.5 * during(accents));
    const applause = syntheticMaterial('synthetic-applause', 3);
    assert.ok(!applause.dry && !applause.bed && energy(applause.mix.channels[0]) > 0);
    assert.notDeepEqual(applause.mix.channels[0], applause.mix.channels[1]);
  });

  it('plays music 2 dB louder than the voice it plays over', () => {
    const { mix, bed, room, dry: voice } = syntheticMaterial('synthetic-room-0.8s-under-music', 6);
    assert.ok(bed && room && voice);
    const spokenRoom = mix.channels[0].map((value, i) => value - bed.channels[0][i]);
    assert.ok(Math.abs(10 * Math.log10(energy(bed.channels[0]) / energy(spokenRoom)) - 2) < 1, `${(10 * Math.log10(energy(bed.channels[0]) / energy(spokenRoom))).toFixed(1)} dB`);
  });

  it('cuts from the voice to music that was not there before', () => {
    const { bed, dry: voice, room } = syntheticMaterial('synthetic-room-0.8s-cut-to-music', 8);
    assert.ok(bed && voice && room);
    const last = voice.reduce((at, value, i) => (Math.abs(value) > 1e-4 ? i : at), 0);
    assert.ok(last > 2 * 48000 && last < 4 * 48000, 'the voice speaks through the first half');
    assert.equal(energy(bed.channels[0].subarray(0, last + 1)), 0, 'no music while it speaks');
    // At its full level from the first 50 ms on, 12 dB under the voice in its room.
    const [first, later] = [bed.channels[0].subarray(last + 1, last + 2401), bed.channels[0].subarray(last + 48000, last + 50400)].map(energy);
    assert.ok(Math.abs(10 * Math.log10(first / later)) < 3, `${(10 * Math.log10(first / later)).toFixed(1)} dB between its first 50 ms and a second on`);
    const spoken = room.parts.reduce((sum, part) => sum + energy(part.channels[0].subarray(0, last)), 0) / last;
    assert.ok(Math.abs(10 * Math.log10(energy(bed.channels[0].subarray(last + 1)) / (bed.channels[0].length - last - 1) / spoken) + 12) < 3);
  });

  it('lets the voice stop while the music plays on, and keeps the music as the bed', () => {
    const { mix, dry: voice, room, bed } = syntheticMaterial('synthetic-room-0.8s-then-music', 6);
    assert.ok(voice && room && bed);
    assert.ok(energy(voice.subarray(0, 3 * 48000)) > 0 && energy(voice.subarray(3 * 48000)) === 0, 'the voice speaks in the first half only');
    assert.ok(energy(bed.channels[0].subarray(4 * 48000)) > 0, 'the music plays on');
    const sum = Float32Array.from(bed.channels[0]);
    for (const part of room.parts) part.channels[0].forEach((value, i) => { sum[i] += value; });
    assert.ok(errorDb(sum, mix.channels[0]) < -100, 'voice, room and music add up to the mix');
  });

  it('brings a manifest clip to 48 kHz stereo', () => {
    const material = loadMaterial('plain', directory);
    assert.equal(material.mix.sampleRate, 48000);
    assert.equal(material.mix.channels.length, 2);
    assert.equal(material.mix.channels[0].length, dry.length * 3);
    assert.deepEqual(material.mix.channels[0], material.mix.channels[1]);
    assert.equal(material.room, undefined);
    assert.equal(material.voice, undefined);
    // A clip of kind "speech" is its own dry voice, so it gets voice rows instead of mix rows.
    const speech = loadMaterial('dry', directory);
    assert.ok(speech.dry && speech.voice);
    assert.ok(errorDb(speech.voice.channels[0], speech.mix.channels[0]) < -100);
  });

  it('rebuilds a room from its dry voice and impulse response, cut at the reference points', () => {
    const { mix, room, dry: voice } = loadMaterial('room', directory);
    assert.ok(room && voice);
    assert.equal(voice.length, dry.length * 3);
    assert.equal(mix.channels[0].length, voice.length);
    // The response's own delay is removed: the direct sound is the dry voice itself, scaled, on the same samples.
    const direct = room.parts[0].channels[0];
    const gain = direct.reduce((sum, value, i) => sum + value * voice[i], 0) / energy(voice);
    assert.ok(errorDb(direct.map(value => value / gain), voice) < -30, `direct sound is the dry voice (${errorDb(direct.map(value => value / gain), voice).toFixed(0)} dB)`);
    assert.ok(energy(room.parts[1].channels[0]) < 1e-6 * energy(direct), 'nothing arrives in the first 10 ms');
    assert.ok(Math.abs(energy(room.parts[2].channels[0]) / energy(direct) - 0.25) < 0.02, 'the 15 ms reflection is 12 dB down');
    assert.ok(Math.abs(room.shares['20ms'] - 0.16 / 0.25) < 0.02 && room.shares['50ms'] === room.shares['20ms']);
  });

  it('keeps a direct sound that is weaker than a wall reflection, by search or from the manifest', () => {
    for (const [id, direct] of [['wall', 0.22], ['faint', 0.04]] as const) {
      const { room } = loadMaterial(id, directory);
      assert.ok(room);
      const [first, , , wall] = room.parts.map(part => energy(part.channels[0]));
      assert.ok(Math.abs(first / wall - (direct / 0.77) ** 2) < 0.1 * (direct / 0.77) ** 2, `${id}: direct sound is ${(10 * Math.log10(first / wall)).toFixed(1)} dB under the wall`);
      assert.ok(room.shares['50ms'] > 0.99 && room.shares['20ms'] < 0.01, `${id}: the wall is a reflection between 20 and 50 ms`);
    }
  });

  it('finds the dry voice in a mix with other sound, at the gain it has in each channel', () => {
    const { mix, voice, dry: reference, room } = loadMaterial('over-music', directory);
    assert.ok(voice && reference && !room);
    const fitted = (channel: number) => voice.channels[channel].reduce((sum, value, i) => sum + value * reference[i], 0) / energy(reference);
    assert.ok(Math.abs(fitted(0) - 0.5) < 0.01 && Math.abs(fitted(1) - 0.25) < 0.01, `${fitted(0)}, ${fitted(1)}`);
    assert.equal(mix.channels[0].length, reference.length);
  });

  it('takes the music out of a mix entry, alone or under a room', () => {
    const alone = loadMaterial('music-alone', directory);
    assert.ok(!alone.dry && !alone.room && !alone.voice && !alone.bed);
    // The mix was 0.5 voice + music on the left and 0.25 voice - music on the right.
    const expected = Float32Array.from(resample(music, rate, 48000));
    assert.ok(errorDb(alone.mix.channels[0], expected) < -25, `the left channel is the music (${errorDb(alone.mix.channels[0], expected).toFixed(0)} dB)`);
    assert.ok(errorDb(alone.mix.channels[1], expected.map(value => -value)) < -25, 'and the right channel its inverse');
    const { mix, room, bed, dry: voice } = loadMaterial('room-over-music', directory);
    assert.ok(room && bed && voice);
    assert.deepEqual(bed.channels[0], alone.mix.channels[0]);
    const plain = loadMaterial('room', directory);
    assert.ok(errorDb(mix.channels[0].map((value, i) => value - bed.channels[0][i]), plain.mix.channels[0]) < -100, 'the room is the same with the music under it');
    assert.throws(() => loadMaterial('no-bed', directory), /takes its bed from 'plain', which names no dry voice/);
  });

  it('reads a WAV path, and says what it looked for when the material is unknown', () => {
    const path = join(directory, 'dry.wav');
    const material = loadMaterial(path, directory);
    assert.equal(material.label, 'dry.wav');
    assert.equal(material.mix.channels[0].length, dry.length * 3);
    assert.throws(() => loadMaterial('no-such-clip', directory), /Unknown material 'no-such-clip'.*synthetic-dry.*over-music/s);
    assert.throws(() => loadMaterial('broken', directory), /refers to 'missing'/);
    const invalid = mkdtempSync(join(directory, 'invalid-'));
    writeFileSync(join(invalid, 'manifest.json'), JSON.stringify({ entries: [{ id: 'ir', file: 'ir.wav', directArrivalSample: -1.5 }] }));
    assert.throws(() => loadMaterial('ir', invalid), /directArrivalSample of 'ir' must be a sample index/);
    assert.throws(() => loadMaterial('fetched', directory), /Material 'fetched' has no audio at .*theater-everywhere.audio-lab.fetched\.wav/);
  });

  // The committed corpus (PR #484) freezes each room as a WAV on the dry voice's timeline; the lab
  // rebuilds the room from its parts and must land on the same samples.
  const corpus = fileURLToPath(new URL('./corpus/', import.meta.url));
  const frozen = existsSync(join(corpus, 'manifest.json'));
  it('mixes the corpus voice in a room with the corpus music', { skip: frozen ? false : 'the corpus is not in this checkout' }, () => {
    const { mix, bed, room } = loadMaterial('room-rt080-over-music');
    assert.ok(bed && room);
    assert.deepEqual(bed.channels[0], loadMaterial('music').mix.channels[0]);
    assert.equal(mix.channels[0].length, bed.channels[0].length);
    assert.ok(energy(bed.channels[0]) > 0.001 * energy(mix.channels[0]), 'the music is in the mix');
  });

  for (const id of ['wall-reflection', 'room-rt080']) {
    it(`rebuilds the corpus room ${id} on the timeline of its frozen WAV`, { skip: frozen ? false : 'the corpus is not in this checkout' }, () => {
      const { mix, room } = loadMaterial(id);
      assert.ok(room);
      const file = readWav(join(corpus, `${id}.wav`));
      const reference = Float32Array.from(resample(file.channels[0], file.sampleRate, mix.sampleRate));
      const rebuilt = mix.channels[0];
      const cross = rebuilt.reduce((sum, value, i) => sum + value * reference[i], 0);
      const correlation = cross / Math.sqrt(energy(rebuilt) * energy(reference));
      assert.ok(correlation > 0.99, `correlation with the frozen WAV at zero lag: ${correlation.toFixed(3)}`);
      assert.ok(energy(room.parts[0].channels[0]) > 0.01 * energy(rebuilt), 'the direct sound is there');
    });
  }
});
