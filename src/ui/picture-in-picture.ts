import type { PlaybackSurface } from '../playback-surface';

/** Runs the same guarded PiP command for the toolbar and keyboard. */
export function togglePictureInPicture(video: PlaybackSurface, doc: Document = document): void {
  if (!video.capabilities.pictureInPicture || !doc.pictureInPictureEnabled) return;
  try {
    const request = doc.pictureInPictureElement
      ? doc.exitPictureInPicture()
      : video.requestPictureInPicture();
    void Promise.resolve(request).catch(error => {
      console.error('[Theater Everywhere] Picture-in-Picture failed:', error);
    });
  } catch (error) {
    console.error('[Theater Everywhere] Picture-in-Picture failed:', error);
  }
}
