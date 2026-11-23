/**
 * Where "the voice" ends and "the room" begins is a choice, and results depend on it. A room's
 * impulse response is cut at explicit reference points after its first arrival: the direct sound
 * alone, and the direct sound with everything arriving within 10, 20 or 50 ms. Each metric that
 * needs a voice or a reverb is reported at every point instead of at one silently chosen split.
 *
 * The classic 50 ms split (C50) is the most forgiving: in a small untreated room about 91 % of the
 * reflected energy arrives before it (TME-279 review), so strong wall reflections count as "voice"
 * and the benefit of removing them disappears from the numbers. `reflectionShares` states that
 * share for the room at hand so a reader can tell which case they are looking at.
 */
export const REFERENCE_POINTS = [
  // Long enough for the direct path's own ringing, shorter than any reflection path in a room.
  { key: 'direct', ms: 2.5, label: 'direct sound' },
  { key: '10ms', ms: 10, label: 'first 10 ms' },
  { key: '20ms', ms: 20, label: 'first 20 ms' },
  { key: '50ms', ms: 50, label: 'first 50 ms' }
] as const;

export type ReferenceKey = typeof REFERENCE_POINTS[number]['key'];

/** A band-limited response rises before its peak; this much before the direct sound still belongs to it. */
const RISE_MS = 1;
/** An arrival is taken at its strongest sample within this time of its onset. */
const ONSET_MS = 0.5;

/** How many samples before the direct sound `splitResponse` keeps: the delay its parts carry against the dry voice. */
export const leadOf = (arrival: number, sampleRate: number): number => Math.min(Math.round(arrival), Math.round(RISE_MS / 1000 * sampleRate));

/**
 * Where the direct sound arrives when nobody says: the onset is the first sample within 20 dB of
 * a channel's peak, the arrival the strongest sample of the half millisecond after it (the ripple
 * ahead of a band-limited impulse crosses the threshold before the impulse does). The earliest
 * channel counts. The direct sound need not be the strongest arrival (a wall behind the
 * microphone can return more than an off-axis talker sends), so the search is not for the peak;
 * a response whose direct sound is weaker than that has to state its arrival itself.
 */
export function firstArrival(response: Float64Array[], sampleRate: number): number {
  let first = Number.POSITIVE_INFINITY;
  for (const channel of response) {
    const peak = channel.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    const onset = channel.findIndex(value => Math.abs(value) > 0.1 * peak);
    if (onset < 0) continue;
    let arrival = onset;
    for (let i = onset; i < Math.min(channel.length, onset + Math.round(ONSET_MS / 1000 * sampleRate)); i++) {
      if (Math.abs(channel[i]) > Math.abs(channel[arrival])) arrival = i;
    }
    first = Math.min(first, arrival);
  }
  return Number.isFinite(first) ? first : 0;
}

/**
 * Cuts a response into consecutive parts at the reference points: `parts[0]` is the direct sound,
 * `parts[i]` what arrives between point `i - 1` and point `i`, and the last part everything after
 * 50 ms. Each part keeps its place in time and the response's leading delay is removed (up to
 * 1 ms before the direct sound, for its rise), so the parts add up to the response as heard.
 * `arrival` is the sample at which the direct sound arrives, when the material knows it.
 */
export function splitResponse(response: Float64Array[], sampleRate: number, arrival = firstArrival(response, sampleRate)): Float64Array[][] {
  const start = Math.round(arrival) - leadOf(arrival, sampleRate);
  const cuts = [0, ...REFERENCE_POINTS.map(point => Math.round(point.ms / 1000 * sampleRate)), Number.POSITIVE_INFINITY];
  return cuts.slice(0, -1).map((from, part) => response.map(channel => {
    const trimmed = channel.subarray(start);
    const to = Math.min(trimmed.length, cuts[part + 1]);
    const out = new Float64Array(Math.max(to, 1));
    for (let i = from; i < to; i++) out[i] = trimmed[i];
    return out;
  }));
}

/** Of the energy of a split response that is not the direct sound, the share arriving before each reference point (0 to 1). */
export function reflectionShares(parts: Float64Array[][]): Record<ReferenceKey, number> {
  const energies = parts.map(part => part.reduce((sum, channel) => sum + channel.reduce((e, value) => e + value * value, 0), 0));
  const reflected = energies.slice(1).reduce((sum, energy) => sum + energy, 0);
  let early = 0;
  const shares = {} as Record<ReferenceKey, number>;
  for (const [index, point] of REFERENCE_POINTS.entries()) {
    if (index > 0) early += energies[index];
    shares[point.key] = reflected > 0 ? early / reflected : 0;
  }
  return shares;
}
