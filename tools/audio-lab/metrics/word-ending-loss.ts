/**
 * Word-ending loss: the voice's level over the speech in the last 60 ms before each pause of
 * 100 ms or more, after minus before. Endings are quiet and sit right behind loud sound, which is
 * where a reverb estimate is highest, so an effect that tracks decay takes them for reverb first.
 * A loss here far above the overall voice loss means clipped word endings.
 *
 * "Speech" follows the frame labels: down to 40 dB under the voice's loud frames. On a voice that
 * fades far before it stops, the last 60 ms are very quiet sound, and a large loss there is a
 * loss of something barely audible; read the row's level along with its change.
 */
import type { Frames } from './frames';
import { framePower, maskedLevel, voiceBand, type Grid } from './grid';

export const wordEndingLevel = (voice: Grid, frames: Frames): number => maskedLevel(framePower(voice, voiceBand(voice)), frames.wordEnding);
