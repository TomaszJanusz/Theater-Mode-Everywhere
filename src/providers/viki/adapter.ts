import { getMuxPreviewFrame, parseMuxStoryboard, type MuxStoryboardSet } from '../../media-features/parsers/mux-storyboard';
import type {
  AudioTrack,
  AudioTrackList,
  CaptionActivationResult,
  CaptionCue,
  CaptionTrack,
  Chapter,
  MediaCapabilities,
  MediaFeaturesAdapter,
  PreviewFrame,
  PreviewSource
} from '../../media-features/types';
import type { ProviderServices } from '../provider-api';

import {
  isVikiCaptionUrl,
  isVikiPreviewImageUrl,
  isVikiPreviewUrl,
  parseVikiPlayback,
  vikiChapters,
  vikiAudioTracks,
  vikiNextDataUrl,
  vikiVideoId,
  type VikiPlayback
} from './playback-data';


/** Set while a Viki track is drawn by the player; providers/viki/presentation.css hides the host's own cues on it. */
const HIDDEN_ATTRIBUTE = 'data-te-viki-captions-hidden';

const PLAYER = '#vmplayer_id.video-js';
const AUDIO_ITEMS = '.vmp-audio-tracks-menu li';
/** Marks the selected row of the player's audio menu. */
const AUDIO_SELECTED = '[data-testid="check-icon"]';
const AUDIO_ACCEPT_MS = 2000;

const failed = (): CaptionActivationResult => ({ status: 'failed', delivery: 'none', cues: [] });

function currentVideoId(): string | null {
  try {
    return vikiVideoId(new URL(window.location.href));
  } catch {
    return null;
  }
}

function embeddedData(): { props?: { pageProps?: unknown }; buildId?: unknown } | null {
  try {
    return JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent || 'null');
  } catch {
    return null;
  }
}

/** The episode's document: the server-rendered one, else the request the page made when navigating to it. */
async function readPlayback(videoId: string): Promise<VikiPlayback | null> {
  const data = embeddedData();
  const embedded = parseVikiPlayback(data?.props?.pageProps, videoId);
  if (embedded) return embedded;
  const names = performance.getEntriesByType('resource').map(entry => entry.name);
  const url = vikiNextDataUrl(names, videoId, window.location.origin, data?.buildId);
  if (!url) return null;
  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) return null;
    return parseVikiPlayback(((await response.json()) as { pageProps?: unknown } | null)?.pageProps, videoId);
  } catch {
    return null;
  }
}

/**
 * Viki paints subtitles into the player's DOM, so the extension draws its own from the files the
 * page itself lists. The page's cues stay the host's until the viewer picks a track here.
 */
export class VikiAdapter implements MediaFeaturesAdapter {
  private playback: VikiPlayback | null = null;
  private storyboard: MuxStoryboardSet | null = null;
  private pending: Promise<void> | null = null;
  private pendingFor: string | null = null;
  private generation = 0;
  private readonly cues = new Map<string, CaptionCue[]>();
  private readonly audioListeners = new Set<() => void>();

  constructor(
    private readonly requestPageFetch: ProviderServices['isolated']['requestPageFetch'],
    private readonly parseCaptionPayload: ProviderServices['isolated']['parseCaptionPayload']
  ) {}

  /** Resolves once per episode; a result for an episode the page has left is dropped. */
  private load(): Promise<void> {
    const videoId = currentVideoId();
    if (!videoId) return Promise.resolve();
    if (this.playback?.videoId === videoId) return this.pending ?? Promise.resolve();
    if (this.pending && this.pendingFor === videoId) return this.pending;
    // A load for another episode is stale: the new one supersedes it.
    this.generation += 1;
    this.playback = null;
    this.storyboard = null;
    this.cues.clear();
    const generation = this.generation;
    const pending = readPlayback(videoId).then(async playback => {
      if (generation !== this.generation || currentVideoId() !== videoId || !playback) return;
      this.playback = playback;
      const previewUrl = playback.previewUrl;
      const body = previewUrl && isVikiPreviewUrl(previewUrl, videoId) ? await this.requestPageFetch(previewUrl, 15000) : null;
      if (generation !== this.generation || this.playback !== playback) return;
      this.storyboard = body ? parseMuxStoryboard(body, isVikiPreviewImageUrl) : null;
    }).then(() => { for (const notify of this.audioListeners) notify(); }).finally(() => { if (this.pending === pending) { this.pending = null; this.pendingFor = null; } });
    this.pending = pending;
    this.pendingFor = videoId;
    return pending;
  }

  /** The loaded episode, only while it is still the one on screen. */
  private current(): VikiPlayback | null {
    return this.playback && this.playback.videoId === currentVideoId() ? this.playback : null;
  }

  async probe(): Promise<MediaCapabilities> {
    await this.load();
    const playback = this.current();
    return {
      captions: Boolean(playback?.captionTracks.length),
      chapters: Boolean(playback && vikiChapters(playback).length),
      previews: Boolean(this.storyboard)
    };
  }

  async listCaptionTracks(): Promise<CaptionTrack[]> {
    await this.load();
    return (this.current()?.captionTracks ?? []).map(({ id, language, label }) => ({
      id, language, label, kind: 'subtitles', source: 'viki', delivery: 'overlay'
    }));
  }

  async activateCaptionTrack(id: string | null): Promise<CaptionActivationResult> {
    if (id === null) {
      this.hostCaptionsHidden(false);
      return { status: 'off', delivery: 'none', cues: [] };
    }
    await this.load();
    const generation = this.generation;
    const playback = this.current();
    const track = playback?.captionTracks.find(item => item.id === id);
    if (!playback || !track || !isVikiCaptionUrl(track.url, playback.videoId)) return failed();
    let cues = this.cues.get(track.url);
    if (!cues) {
      const body = await this.requestPageFetch(track.url, 15000);
      cues = body ? this.parseCaptionPayload(body) : [];
      // The episode or adapter may have changed while the file downloaded.
      if (generation !== this.generation || this.current() !== playback) return failed();
      if (cues.length) this.cues.set(track.url, cues);
    }
    if (!cues.length) return failed();
    this.hostCaptionsHidden(true);
    return { status: 'active', delivery: 'overlay', cues };
  }

  async getChapters(): Promise<Chapter[]> {
    await this.load();
    const playback = this.current();
    return playback ? vikiChapters(playback).map(chapter => ({ ...chapter, source: 'viki', confidence: 'high' as const })) : [];
  }

  async getPreviewSource(): Promise<PreviewSource> {
    await this.load();
    return this.storyboard && this.current() ? { kind: 'sprite', provider: 'viki' } : { kind: 'none', reason: 'no-viki-preview' };
  }

  getPreviewFrame(time: number): PreviewFrame | null {
    return this.storyboard && this.current() ? getMuxPreviewFrame(this.storyboard, time, isVikiPreviewImageUrl) : null;
  }

  /** The menu's rows with the tracks they describe, read in one pass so a position means the same row. */
  private audioMenu(): { list: AudioTrackList; items: HTMLElement[] } | null {
    const playback = this.current();
    const player = document.querySelector(PLAYER);
    if (!playback || !player) return null;
    const items = [...player.querySelectorAll<HTMLElement>(AUDIO_ITEMS)];
    if (!items.length) return null;
    const tracks: AudioTrack[] = vikiAudioTracks(
      items.map(item => ({ label: item.textContent ?? '', selected: item.querySelector(AUDIO_SELECTED) !== null })),
      playback.audioLanguages, playback.originalLanguage);
    // Viki plays bumpers and ads in this player; a pick made then would not reach the episode.
    const blocked = [...player.classList].some(name => name.startsWith('vjs-ad-'));
    return { list: { mediaId: playback.videoId, tracks, blocked }, items };
  }

  listAudioTracks(): AudioTrackList | null {
    return this.audioMenu()?.list ?? null;
  }

  /** Clicks the host's own menu row, after checking the episode, the block and the row against the live menu. */
  async selectAudioTrack(id: string, mediaId: string | null): Promise<boolean> {
    const menu = this.audioMenu();
    if (!menu || menu.list.blocked || menu.list.mediaId !== mediaId) return false;
    const index = menu.list.tracks.findIndex(track => track.id === id);
    if (index < 0) return false;
    const item = menu.items[index];
    if (menu.list.tracks[index].selected) return true;
    item.click();
    return new Promise<boolean>(resolve => {
      const accepted = () => item.isConnected && item.querySelector(AUDIO_SELECTED) !== null;
      const observer = new MutationObserver(() => { if (accepted()) done(true); });
      const timer = setTimeout(() => done(accepted()), AUDIO_ACCEPT_MS);
      const done = (ok: boolean) => { observer.disconnect(); clearTimeout(timer); resolve(ok); };
      observer.observe(item, { subtree: true, childList: true, attributes: true });
      if (accepted()) done(true);
    });
  }

  /** Reports a changed list, selection or block; the player's own DOM churns, so only a changed list notifies. */
  observeAudioTracks(onChange: () => void): () => void {
    const player = document.querySelector(PLAYER);
    if (!player) return () => {};
    const signature = () => JSON.stringify(this.audioMenu()?.list ?? null);
    let last = signature();
    let frame = 0;
    const check = () => {
      frame = 0;
      const next = signature();
      if (next !== last) { last = next; onChange(); }
    };
    const schedule = () => { if (!frame && !document.hidden) frame = requestAnimationFrame(check); };
    const observer = new MutationObserver(schedule);
    observer.observe(player, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    // The episode's data arrives after the menu, and tags depend on it.
    this.audioListeners.add(schedule);
    return () => {
      observer.disconnect();
      this.audioListeners.delete(schedule);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
  }

  mediaId(): string | null {
    return this.current()?.videoId ?? null;
  }

  private hostCaptionsHidden(hidden: boolean): void {
    document.documentElement.toggleAttribute(HIDDEN_ATTRIBUTE, hidden);
  }

  invalidate(): void {
    this.generation += 1;
    this.playback = null;
    this.storyboard = null;
    this.pending = null;
    this.pendingFor = null;
    this.cues.clear();
    this.hostCaptionsHidden(false);
  }

  async reload(): Promise<void> {
    this.invalidate();
    await this.load();
  }

  dispose(): void {
    this.invalidate();
  }
}
