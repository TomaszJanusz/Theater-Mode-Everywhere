/**
 * The speech window of `assembly/echo-reduction.ts`, in float64 and under the same names: when the
 * gain is free to fall. It is freed when a syllable ends (the level of the speech bands rose, held
 * for a moment and falls within about half a second) and kept free by each further syllable, for
 * 0.8 s after the last one and, less and less, for 0.4 s more.
 */
const EPSILON = 1e-20;
/** The rise that starts a fed band, and a syllable. */
export const RISE_FROM = 1.5;
const [TAIL_SECONDS, TAIL_FADE_SECONDS] = [0.8, 0.4];
const [SPEECH_GATE, TREND_SHARE, TREND_TOP, RISE_MEMORY_SECONDS] = [0.01, 0.3, 4, 0.08];
const [HOLD_FROM, HOLD_SLOPE, SYLLABLE_FROM, SYLLABLE_SPAN, CLEAR_FROM, CLEAR_SLOPE] = [0.6, 5, 0.007, 0.012, 0.2, 5];
const [FALL_FROM, FALL_SLOPE, SYLLABLE_SECONDS] = [0.85, 5, 0.6];

export const unit = (value: number): number => Math.max(0, Math.min(1, value));

export function speechWindow(hopSeconds: number) {
  const riseFade = Math.exp(-hopSeconds / RISE_MEMORY_SECONDS);
  // Seconds since the last syllable; the smoothed change of the level, its latest rise, for how long
  // the level has held since, and how far a syllable is sounding that has not ended yet.
  let sinceSpeech = TAIL_SECONDS + TAIL_FADE_SECONDS;
  let [trend, risen, held, spoken] = [1, 0, 0, 0];
  /** How far the gain may fall in the coming frame: 1 for 0.8 s after the last syllable, then down to 0. */
  const tail = (): number => unit((TAIL_SECONDS + TAIL_FADE_SECONDS - sinceSpeech) / TAIL_FADE_SECONDS);
  return {
    tail,
    /** Takes the level of the speech bands in this frame and before the gap, each band against its own recent peak. */
    hear(level: number, before: number): void {
      const free = tail();
      const change = level / (before + EPSILON);
      trend += TREND_SHARE * (Math.min(change, TREND_TOP) - trend);
      const rising = unit(trend - RISE_FROM);
      const falling = unit((FALL_FROM - trend) * FALL_SLOPE);
      risen = Math.max(rising * unit(level / SPEECH_GATE - 1), risen * riseFade);
      // Counted from the end of the rise, so that the quiet before a sound does not count as holding.
      held = (held + hopSeconds) * unit((change - HOLD_FROM) * HOLD_SLOPE) * (1 - rising);
      const syllable = unit((risen * unit((held - SYLLABLE_FROM) / SYLLABLE_SPAN) - CLEAR_FROM) * CLEAR_SLOPE);
      spoken = Math.max(spoken - hopSeconds / SYLLABLE_SECONDS, syllable);
      sinceSpeech = Math.min(sinceSpeech, (TAIL_SECONDS + TAIL_FADE_SECONDS) * (1 - Math.max(spoken * falling, syllable * free))) + hopSeconds;
    }
  };
}
