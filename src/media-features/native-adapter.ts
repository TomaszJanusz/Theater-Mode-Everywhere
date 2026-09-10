import { sanitizeCaptionText } from './sanitize';
import type { CaptionCue, CaptionTrack, Chapter, MediaCapabilities, MediaFeaturesAdapter } from './types';

function trackUsable(track: TextTrack): boolean {
  const kind = track.kind as string;
  return kind === 'subtitles' || kind === 'captions' || kind === '';
}

function chapterUsable(track: TextTrack): boolean {
  return track.kind === 'chapters';
}

function cuesFromTrack(track: TextTrack): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const list = track.cues;
  if (!list) return cues;
  for (let i = 0; i < list.length; i++) {
    const cue = list[i];
    if (!(cue instanceof TextTrackCue)) continue;
    const text = 'text' in cue && typeof cue.text === 'string' ? cue.text : '';
    cues.push({
      start: cue.startTime,
      end: cue.endTime > cue.startTime ? cue.endTime : cue.startTime + 0.001,
      text: String(text)
    });
  }
  return cues;
}

export class NativeTextTrackAdapter implements MediaFeaturesAdapter {
  private video: HTMLVideoElement;
  private restoredModes = new Map<TextTrack, TextTrackMode>();

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  async probe(): Promise<MediaCapabilities> {
    const tracks = Array.from(this.video.textTracks || []);
    return {
      captions: tracks.some(trackUsable),
      chapters: tracks.some(chapterUsable),
      previews: false
    };
  }

  async listCaptionTracks(): Promise<CaptionTrack[]> {
    const tracks = Array.from(this.video.textTracks || []);
    return tracks.filter(trackUsable).map((track, index) => ({
      id: `native:${index}`,
      language: track.language || '',
      label: track.label || track.language || '',
      kind: track.kind === 'captions' ? 'captions' : 'subtitles',
      source: 'native-text-track'
    }));
  }

  async activateCaptionTrack(id: string | null): Promise<CaptionCue[] | null> {
    const tracks = Array.from(this.video.textTracks || []).filter(trackUsable);
    if (id === null) {
      for (const track of tracks) track.mode = 'disabled';
      return null;
    }
    const index = Number(id.replace('native:', ''));
    tracks.forEach((track, i) => {
      track.mode = i === index ? 'showing' : 'disabled';
    });
    return [];
  }

  async getChapters(): Promise<Chapter[]> {
    const tracks = Array.from(this.video.textTracks || []).filter(chapterUsable);
    for (const track of tracks) {
      if (track.mode === 'disabled') {
        this.restoredModes.set(track, track.mode);
        track.mode = 'hidden';
      }
      if (!track.cues || track.cues.length === 0) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 50);
        });
      }
      const cues = cuesFromTrack(track);
      if (cues.length === 0) continue;
      return cues.map((cue, index) => ({
        start: cue.start,
        end: index + 1 < cues.length ? cues[index + 1].start : cue.end,
        title: sanitizeCaptionText(cue.text),
        source: 'native-chapters',
        confidence: 'high' as const
      }));
    }
    return [];
  }

  dispose(): void {
    this.restoredModes.forEach((mode, track) => {
      try {
        track.mode = mode;
      } catch {
        // Track may already be gone with the media element.
      }
    });
    this.restoredModes.clear();
  }
}
