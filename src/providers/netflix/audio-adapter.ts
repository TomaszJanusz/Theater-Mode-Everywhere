import type { CaptionActivationResult, MediaFeaturesAdapter } from '../../media-features/types';

import { NetflixAudioClient, type AudioRecoveryClock } from './audio-client';

/** Audio-only companion to the legacy data adapter, until TME-202 composes the full provider. */
export class NetflixAudioAdapter implements MediaFeaturesAdapter {
  private readonly audio: NetflixAudioClient;
  constructor(video: HTMLVideoElement | null, clock?: AudioRecoveryClock) { this.audio = new NetflixAudioClient(video, clock); }
  listAudioTracks() { return this.audio.list(); }
  selectAudioTrack(id: string, mediaId: string | null) { return this.audio.select(id, mediaId); }
  observeAudioTracks(onChange: () => void) { return this.audio.observe(onChange); }
  probe() { return Promise.resolve({ captions: false, chapters: false, previews: false }); }
  listCaptionTracks() { return Promise.resolve([]); }
  activateCaptionTrack(): Promise<CaptionActivationResult> { return Promise.resolve({ status: 'off', delivery: 'none', cues: [] }); }
  getChapters() { return Promise.resolve([]); }
  getPreviewSource() { return Promise.resolve({ kind: 'none', reason: 'unsupported' } as const); }
  invalidate() { this.audio.invalidate(); }
  dispose() { this.audio.dispose(); }
}
