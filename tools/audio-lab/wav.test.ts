import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeWav, encodeWav } from './wav';

/** A minimal RIFF file around raw sample bytes. */
function wav(format: { tag: number; channels: number; rate: number; bits: number }, data: Uint8Array, extra = new Uint8Array(0)): Uint8Array {
  const header = new DataView(new ArrayBuffer(36));
  const ascii = (at: number, text: string) => [...text].forEach((char, i) => header.setUint8(at + i, char.charCodeAt(0)));
  ascii(0, 'RIFF'); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  header.setUint32(16, 16, true); header.setUint16(20, format.tag, true); header.setUint16(22, format.channels, true);
  header.setUint32(24, format.rate, true); header.setUint16(34, format.bits, true);
  const chunk = new DataView(new ArrayBuffer(8));
  [...'data'].forEach((char, i) => chunk.setUint8(i, char.charCodeAt(0)));
  chunk.setUint32(4, data.length, true);
  return Uint8Array.from([...new Uint8Array(header.buffer), ...extra, ...new Uint8Array(chunk.buffer), ...data]);
}

describe('audio lab: WAV', () => {
  it('writes 16-bit PCM that reads back within one step, channels in order', () => {
    const signal = { sampleRate: 16000, channels: [Float32Array.of(0, 0.5, -0.5, 1, -1, 2), Float32Array.of(0.25, 0, 0, 0, 0, -3)] };
    const back = decodeWav(encodeWav(signal));
    assert.equal(back.sampleRate, 16000);
    assert.equal(back.channels.length, 2);
    const expected = [[0, 0.5, -0.5, 1, -1, 1], [0.25, 0, 0, 0, 0, -1]];
    for (const [c, channel] of back.channels.entries()) {
      channel.forEach((value, i) => assert.ok(Math.abs(value - expected[c][i]) < 1 / 16384, `channel ${c} sample ${i}: ${value}`));
    }
  });

  it('reads 24-bit, 32-bit and float samples, and skips chunks it does not know', () => {
    const pcm24 = decodeWav(wav({ tag: 1, channels: 1, rate: 48000, bits: 24 }, Uint8Array.of(0, 0, 0x40, 0, 0, 0xc0)));
    assert.deepEqual(Array.from(pcm24.channels[0]), [0.5, -0.5]);
    const int32 = new DataView(new ArrayBuffer(4));
    int32.setInt32(0, -(2 ** 30), true);
    assert.deepEqual(Array.from(decodeWav(wav({ tag: 1, channels: 1, rate: 8000, bits: 32 }, new Uint8Array(int32.buffer))).channels[0]), [-0.5]);
    const float = new DataView(new ArrayBuffer(8));
    float.setFloat32(0, 0.25, true);
    float.setFloat32(4, -1.5, true);
    const list = Uint8Array.from([...'LIST'].map(char => char.charCodeAt(0)).concat([3, 0, 0, 0, 1, 2, 3, 0]));
    const stereo = decodeWav(wav({ tag: 3, channels: 2, rate: 44100, bits: 32 }, new Uint8Array(float.buffer), list));
    assert.equal(stereo.sampleRate, 44100);
    assert.deepEqual(stereo.channels.map(channel => channel[0]), [0.25, -1.5]);
  });

  it('refuses what it cannot decode', () => {
    assert.throws(() => decodeWav(Uint8Array.of(1, 2, 3)), /Not a RIFF WAVE/);
    assert.throws(() => decodeWav(wav({ tag: 1, channels: 1, rate: 8000, bits: 8 }, Uint8Array.of(0))), /Unsupported WAV encoding/);
    assert.throws(() => decodeWav(wav({ tag: 1, channels: 1, rate: 8000, bits: 16 }, Uint8Array.of()).subarray(0, 36)), /no data chunk/);
  });
});
