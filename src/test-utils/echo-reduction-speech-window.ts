/**
 * The speech window of `assembly/echo-reduction.ts`, in float64 and under the same names: how far
 * the gain is free to fall. It is free while a syllable sounds (the level of the speech bands rose
 * and then held) and for 0.8 s after, less and less for 0.4 s more; only while that level is
 * falling or has just fallen; and only as far as the DSP is sure it hears speech.
 */
const EPSILON = 1e-20;
/** The rise that starts a fed band, and a syllable. */
export const RISE_FROM = 1.5;
const [TAIL_SECONDS, TAIL_FADE_SECONDS] = [0.8, 0.4];
const [SPEECH_GATE, TREND_SHARE, TREND_TOP, RISE_MEMORY_SECONDS] = [0.01, 0.3, 4, 0.08];
const [HOLD_FROM, HOLD_SLOPE, SYLLABLE_FROM, SYLLABLE_SPAN, CLEAR_FROM, CLEAR_SLOPE] = [0.6, 5, 0.007, 0.012, 0.2, 5];
const [HELD_SLOPE, SYLLABLE_SECONDS, SOUNDING_SLOPE, FALL_FROM, FALL_SLOPE, FALLING_SECONDS] = [200, 2, 10, 0.85, 10, 0.1];
const [SURE_STEP, CLEAR_OF_FROM, CLEAR_OF_SPAN, RISE_KEPT, SURE_RISE, SURE_FALL, SURE_TOP] = [0.4, 8, 24, 20, 1.5, 0.5, 1.3];

export const unit = (value: number): number => Math.max(0, Math.min(1, value));

/** What a frame tells the window: the level of the speech bands now and before the gap, each band against its own recent peak, and their plain power. */
export type Heard = { level: number; before: number; totalNow: number; totalWas: number };

export function speechWindow(hopSeconds: number) {
  const riseFade = Math.exp(-hopSeconds / RISE_MEMORY_SECONDS);
  // Seconds since the last syllable; the smoothed change of the level, its latest rise, for how long
  // the level has held since, and for how many more seconds a syllable may sound on.
  let sinceSpeech = TAIL_SECONDS + TAIL_FADE_SECONDS;
  let [trend, risen, held, sounding] = [1, 0, 0, 0];
  // How far the level is falling or has just fallen; how sure the DSP is of speech; whether the latest
  // rise has still to be counted as a syllable; and the power of the speech bands before that rise.
  let [sinking, sure, fresh, quietBefore] = [0, 0, 0, 0];
  return {
    /** How far the gain may fall in the coming frame, 0 to 1. */
    tail: (): number => unit((TAIL_SECONDS + TAIL_FADE_SECONDS - sinceSpeech) / TAIL_FADE_SECONDS) * sinking * unit(sure),
    hear({ level, before, totalNow, totalWas }: Heard): void {
      const change = level / (before + EPSILON);
      trend += TREND_SHARE * (Math.min(change, TREND_TOP) - trend);
      const rising = unit(trend - RISE_FROM);
      risen = Math.max(rising * unit(level / SPEECH_GATE - 1), risen * riseFade);
      // Counted from the end of the rise, so that the quiet before a sound does not count as holding.
      held = (held + hopSeconds) * unit((change - HOLD_FROM) * HOLD_SLOPE) * (1 - rising);
      const syllable = unit((risen * unit((held - SYLLABLE_FROM) / SYLLABLE_SPAN) - CLEAR_FROM) * CLEAR_SLOPE);
      sounding = Math.max(sounding - hopSeconds, syllable * SYLLABLE_SECONDS) * unit(held * HELD_SLOPE);
      const spoken = unit(sounding * SOUNDING_SLOPE);
      sinceSpeech = Math.min(sinceSpeech, (TAIL_SECONDS + TAIL_FADE_SECONDS) * (1 - spoken)) + hopSeconds;
      sinking = Math.max(unit((FALL_FROM - trend) * FALL_SLOPE), sinking - hopSeconds / FALLING_SECONDS);
      // Each rise counts once, by how far it lifted the speech bands above what sounded before it.
      quietBefore += (1 - unit(risen * RISE_KEPT)) * (totalWas - quietBefore);
      const step = SURE_STEP + (1 - SURE_STEP) * unit((totalNow / (quietBefore + EPSILON) - CLEAR_OF_FROM) / CLEAR_OF_SPAN);
      sure = Math.max(Math.min(sure + step * syllable * fresh + hopSeconds * (spoken * SURE_RISE - SURE_FALL), SURE_TOP), 0);
      fresh = Math.max(fresh, rising) * (1 - syllable);
    }
  };
}
