// The player signs playback requests, including the subtitle view, with WBI.
// Keys are the public fallback baked into the player, unless the page stored newer ones.
const MIXIN_INDEX = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
const ENCODED_IMG_KEY = 'd569546b86c252:db:9bc7e99c5d71e5';
const ENCODED_SUB_KEY = '557251g796:g54:f:ee94g8fg969e2de';

function decodePlayerKey(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) out += String.fromCharCode(value.charCodeAt(i) - 1);
  return out;
}

function fileKey(value: string | undefined): string {
  if (!value) return '';
  const name = value.slice(value.lastIndexOf('/') + 1).split('.')[0];
  return /^[A-Za-z0-9]+$/.test(name) ? name : '';
}

function wbiKeys(): { img: string; sub: string } {
  try {
    const stored = globalThis.localStorage?.getItem('wbi_img_urls')?.split('-') || [];
    const img = fileKey(stored[0]);
    const sub = fileKey(stored[1]);
    if (img && sub) return { img, sub };
  } catch {
    // Private mode can reject storage. The player fallback keys still sign the request.
  }
  return { img: decodePlayerKey(ENCODED_IMG_KEY), sub: decodePlayerKey(ENCODED_SUB_KEY) };
}

export function wbiMixin(material: string): string {
  let mixed = '';
  for (const index of MIXIN_INDEX) {
    const char = material.charAt(index);
    if (char) mixed += char;
  }
  return mixed.slice(0, 32);
}

/** MD5 hex of an ASCII string. WBI query text is ASCII. */
export function md5Hex(message: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < message.length; i++) bytes.push(message.charCodeAt(i) & 0xff);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push((bitLength / 2 ** (8 * i)) & 0xff);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const shift = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const sine = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32));

  const left = (value: number, bits: number) => (value << bits) | (value >>> (32 - bits));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words: number[] = [];
    for (let i = 0; i < 64; i += 4) {
      words.push(bytes[offset + i] | (bytes[offset + i + 1] << 8) | (bytes[offset + i + 2] << 16) | (bytes[offset + i + 3] << 24));
    }
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f = 0;
      let g = 0;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const next = (a + f + sine[i] + words[g]) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + left(next, shift[(i >> 4) * 4 + (i % 4)])) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  const hex = (value: number) => Array.from({ length: 4 }, (_, index) => ((value >>> (8 * index)) & 0xff).toString(16).padStart(2, '0')).join('');
  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

export function signBilibiliWbi(params: Record<string, string | number>, nowMs = Date.now()): string {
  const mixin = wbiMixin(wbiKeys().img + wbiKeys().sub);
  const fields: Record<string, string> = { web_location: '1315873' };
  for (const [key, value] of Object.entries(params)) {
    if (value === '' || value === undefined || value === null) continue;
    fields[key] = String(value).replace(/[!'()*]/g, '');
  }
  fields.wts = String(Math.round(nowMs / 1000));
  const signed = Object.keys(fields).sort().map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(fields[key])}`).join('&');
  const rid = md5Hex(signed + mixin);
  return `${signed}&w_rid=${rid}`;
}
