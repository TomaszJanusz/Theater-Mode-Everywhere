/**
 * Reverb-tail decay: the level of the room's sound in the pause tails (50 to 300 ms after the
 * voice stops), 80 Hz to 12 kHz, energy-weighted. The drop the effect achieves is the level after
 * minus the level before; this is what echo reduction is for.
 *
 * With a known room the measured signal is the reverb alone, at a stated reference point. With
 * only a mix it is whatever sounds after speech stops: on a film that is music and effects as much
 * as room, and a dry voice over music shows the same "decay" as a reverberant one, so the mix
 * figure describes how far the effect ducks the mix, not the room.
 */
import type { Frames } from './frames';
import { framePower, maskedLevel, voiceBand, type Grid } from './grid';

export const tailLevel = (reverb: Grid, frames: Frames): number => maskedLevel(framePower(reverb, voiceBand(reverb)), frames.tail);
