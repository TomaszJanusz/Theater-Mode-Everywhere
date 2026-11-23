/**
 * Word-ending loss: the voice's level over the last 60 ms of each word (before a pause of 100 ms
 * or more), after minus before. Endings are quiet and sit right behind loud sound, which is where
 * a reverb estimate is highest, so an effect that tracks decay takes them for reverb first. A loss
 * here far above the overall voice loss means clipped word endings.
 */
import type { Frames } from './frames';
import { framePower, maskedLevel, voiceBand, type Grid } from './grid';

export const wordEndingLevel = (voice: Grid, frames: Frames): number => maskedLevel(framePower(voice, voiceBand(voice)), frames.wordEnding);
