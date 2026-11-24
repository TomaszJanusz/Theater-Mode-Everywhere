/**
 * The speech window of `assembly/echo-reduction.ts`, in float64 and under the same names: how far
 * the gain is free to fall. It is free while a syllable sounds (the level of the speech bands rose
 * and then held) and for 0.8 s after, less and less for 0.4 s more; only while that level is
 * falling or has just fallen; and only as far as the DSP is sure it hears speech.
 */
const EPSILON = 1e-20;
/** The rise that starts a fed band, and a syllable. */
export const RISE_FROM = 1.5;
const [TAIL_SECONDS, TAIL_FADE_SECONDS, REFERENCE_HOP_RATE] = [0.8, 0.4, 187.5];
const [SPEECH_GATE, TREND_SECONDS, TREND_TOP, RISE_MEMORY_SECONDS] = [0.01, 0.014953, 4, 0.08];
const [HOLD_FROM, HOLD_SLOPE, SYLLABLE_FROM, SYLLABLE_SPAN, CLEAR_FROM, CLEAR_SLOPE] = [0.6, 5, 0.007, 0.012, 0.2, 5];
const [GONE_FROM, GONE_SLOPE, SYLLABLE_SECONDS, SOUNDING_SLOPE, FALL_FROM, FALL_SLOPE, FALLING_SECONDS] = [0.4, 5, 2, 10, 0.85, 10, 0.1];
const [SURE_STEP, CLEAR_OF_FROM, CLEAR_OF_SPAN, RISE_KEPT, SURE_RISE, SURE_FALL, SURE_TOP] = [0.4, 8, 24, 20, 1, 0.5, 1.3];
const [NEW_SHAPE_FROM, NEW_SHAPE_SPAN] = [0.4, 0.2];

export const unit = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * What a frame tells the window: per band, how loud it is against its own recent peak (`parts`);
 * the same before the gap, summed (`before`); and the plain power of the bands now and then.
 */
export type Heard = { parts: number[]; before: number; totalNow: number; totalWas: number };

export function speechWindow(hopSeconds: number) {
  const riseFade = Math.exp(-hopSeconds / RISE_MEMORY_SECONDS);
  const trendShare = 1 - Math.exp(-hopSeconds / TREND_SECONDS);
  // The hop in units of the hop at 48 kHz: a frame half as long takes half as much away.
  const pace = hopSeconds * REFERENCE_HOP_RATE;
  const kept = (stays: number) => Math.max(0, 1 - pace * (1 - stays));
  // Seconds since the last syllable; the smoothed change of the level, its latest rise, for how long
  // the level has held since, and for how many more seconds a syllable may sound on.
  let sinceSpeech = TAIL_SECONDS + TAIL_FADE_SECONDS;
  let [trend, risen, held, sounding] = [1, 0, 0, 0];
  // How far the level is falling or has just fallen; how sure the DSP is of speech; whether the latest
  // rise has still to be counted, and how much of a syllable the last frame counted; the power of the
  // speech bands before that rise; and the shape (`parts`) of the syllable counted last.
  let [sinking, sure, fresh, counting, quietBefore] = [0, 0, 0, 0, 0];
  const shape: number[] = [];
  return {
    /** How far the gain may fall in the coming frame, 0 to 1. */
    tail: (): number => unit((TAIL_SECONDS + TAIL_FADE_SECONDS - sinceSpeech) / TAIL_FADE_SECONDS) * sinking * unit(sure),
    hear({ parts, before, totalNow, totalWas }: Heard): void {
      let [level, apart] = [0, 0];
      for (const [b, part] of parts.entries()) {
        const last = shape[b] ?? 0;
        apart += Math.abs(part - last);
        shape[b] = last + counting * (part - last);
        level += part;
      }
      const change = level / (before + EPSILON);
      trend += trendShare * (Math.min(change, TREND_TOP) - trend);
      const rising = unit(trend - RISE_FROM);
      risen = Math.max(rising * unit(level / SPEECH_GATE - 1), risen * riseFade);
      // Counted from the end of the rise, so that the quiet before a sound does not count as holding.
      held = (held + hopSeconds) * kept(unit((change - HOLD_FROM) * HOLD_SLOPE) * (1 - rising));
      const syllable = unit((risen * unit((held - SYLLABLE_FROM) / SYLLABLE_SPAN) - CLEAR_FROM) * CLEAR_SLOPE);
      sounding = Math.max(sounding - hopSeconds, syllable * SYLLABLE_SECONDS) * kept(unit((totalNow / (totalWas + EPSILON) - GONE_FROM) * GONE_SLOPE));
      const spoken = unit(sounding * SOUNDING_SLOPE);
      sinceSpeech = Math.min(sinceSpeech, (TAIL_SECONDS + TAIL_FADE_SECONDS) * (1 - spoken)) + hopSeconds;
      sinking = Math.max(unit((FALL_FROM - trend) * FALL_SLOPE), sinking - hopSeconds / FALLING_SECONDS);
      // Each rise counts once: for its new shape, and for how far it lifted the speech bands above what
      // sounded before it.
      quietBefore += (1 - unit(risen * RISE_KEPT)) * (totalWas - quietBefore);
      const step = SURE_STEP * unit((apart - NEW_SHAPE_FROM) / NEW_SHAPE_SPAN) + (1 - SURE_STEP) * unit((totalNow / (quietBefore + EPSILON) - CLEAR_OF_FROM) / CLEAR_OF_SPAN);
      counting = Math.min(syllable * fresh * pace, 1);
      sure = Math.max(Math.min(sure + step * counting + hopSeconds * (spoken * SURE_RISE - SURE_FALL), SURE_TOP), 0);
      fresh = Math.max(fresh, rising) * kept(1 - syllable);
    }
  };
}
