/**
 * Reverb-tail decay: the level of the room's late sound in the pause tails (50 to 300 ms after
 * the voice stops), 80 Hz to 12 kHz, energy-weighted. The drop the effect achieves is the level
 * after minus the level before; this is what echo reduction is for.
 *
 * With a known room the measured signal is the late reverb alone: what arrives more than 50 ms
 * after the direct sound. The window does not keep early reflections out by itself (a reflection
 * 49 ms behind the last syllable lands in the first tail frames), so they are left out of the
 * signal. With only a mix, the signal is whatever sounds after speech stops: on a film that is
 * music and effects as much as room, and a dry voice over music shows the same "decay" as a
 * reverberant one, so the mix figure describes how far the effect ducks the mix, not the room.
 */
import type { Frames } from './frames';
import { framePower, maskedLevel, voiceBand, type Grid } from './grid';

export const tailLevel = (reverb: Grid, frames: Frames): number => maskedLevel(framePower(reverb, voiceBand(reverb)), frames.tail);
