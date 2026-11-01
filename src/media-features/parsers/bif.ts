/** Roku BIF thumbnail sets, as Disney+ and Crunchyroll serve them. */
const BIF_MAGIC = [0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];

export function hasBifMagic(bytes: Uint8Array): boolean {
  return BIF_MAGIC.every((value, index) => bytes[index] === value);
}

export type BifFrame = {
  time: number;
  start: number;
  end: number;
};

export type BifSet = {
  width: number;
  height: number;
  frames: BifFrame[];
  buffer: ArrayBuffer;
};

export function bifTimestampSeconds(timestamp: number, multiplier: number, intervalMs = 10_000): number | null {
  if (!Number.isFinite(timestamp) || timestamp === 0xffffffff) return null;
  const unit = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1000;
  if (unit <= 1 && timestamp >= 1000) return timestamp / 1000;
  if (unit >= 1000 && timestamp >= unit) return timestamp / 1000;
  const seconds = timestamp * unit / 1000;
  return seconds >= 0 ? seconds : (intervalMs > 0 ? timestamp * (intervalMs / 1000) : null);
}

export function parseRokuBif(buffer: ArrayBuffer, meta?: { width?: number; height?: number; intervalMs?: number }): BifSet | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength < 80) return null;
  if (!hasBifMagic(bytes)) return null;
  const view = new DataView(buffer);
  const count = view.getUint32(12, true);
  const multiplier = view.getUint32(16, true) || 1000;
  if (count < 1 || count > 4000) return null;
  const frames: BifFrame[] = [];
  for (let i = 0; i < count; i++) {
    const at = 64 + i * 8;
    const nextAt = at + 8;
    if (nextAt + 8 > bytes.byteLength) break;
    const timestamp = view.getUint32(at, true);
    const start = view.getUint32(at + 4, true);
    const end = view.getUint32(nextAt + 4, true);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start >= bytes.byteLength) continue;
    const mapped = bifTimestampSeconds(timestamp, multiplier, meta?.intervalMs);
    const time = mapped == null
      ? i * ((meta?.intervalMs || 10_000) / 1000)
      : mapped;
    frames.push({ time, start, end: Math.min(end, bytes.byteLength) });
  }
  if (frames.length === 0) return null;
  return {
    width: meta?.width && meta.width > 0 ? meta.width : 480,
    height: meta?.height && meta.height > 0 ? meta.height : 270,
    frames,
    buffer
  };
}
