import type { AudioSettings } from '../audio-settings';

/** Arguments of the DSP's `configure` (assembly/echo-reduction.ts); seconds and decibels. */
export type EchoPreset = { rt60: number; overSubtraction: number; floorDb: number; gap: number };
export type EchoLevel = Exclude<AudioSettings['echo'], 'off'>;

/**
 * One algorithm, two strengths (TME-259). Light is strength 1 of the spike's sweep. Strong is tuned to
 * the outcome the spike measured at strength 1.5 (about 3 dB less voice and 10 dB less tail in a
 * 0.8 s room) rather than to its parameters, because this gain rule is a little harsher. Stronger
 * settings cost far more voice for little extra intelligibility, and the residual turns watery.
 * Only the worklet module reads these, so they stay out of the shared bundles.
 */
export const ECHO_PRESETS: Record<EchoLevel, EchoPreset> = {
  light: { rt60: 0.5, overSubtraction: 1, floorDb: -8, gap: 0.06 },
  strong: { rt60: 0.65, overSubtraction: 1.15, floorDb: -11, gap: 0.055 }
};
