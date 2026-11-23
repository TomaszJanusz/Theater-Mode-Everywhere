/**
 * Voice loss: how much quieter the voice itself is with the effect on. It is the level of the
 * voice over the frames in which it speaks, 80 Hz to 12 kHz, energy-weighted; the loss is the
 * level after minus the level before.
 *
 * "The voice" must be the voice alone (a part of the mix followed through the effect), measured at
 * a stated reference point: counted as direct sound only, removing wall reflections costs it
 * nothing; counted with the first 50 ms, the same removal reads as voice loss.
 */
import type { Frames } from './frames';
import { framePower, maskedLevel, voiceBand, type Grid } from './grid';

export const voiceLevel = (voice: Grid, frames: Frames): number => maskedLevel(framePower(voice, voiceBand(voice)), frames.speech);
