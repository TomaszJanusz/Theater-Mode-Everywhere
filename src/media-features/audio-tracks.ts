import { audioPreferenceForTrack, pickPreferredAudioTrack } from './audio-preference';
import type { AudioTrack, AudioTrackList, MediaFeaturesAdapter } from './types';

export type AudioTrackOptions = {
  /** The current service's saved preference, read when an item's tracks first appear; null lets the service decide. */
  preference: () => string | null;
  /** Saves what a viewer's pick says about later items on this service. */
  onPreferenceChange?: (preference: string) => void;
  /** Locales whose language names may appear in untagged host labels. */
  locales: () => readonly string[];
  onChange: () => void;
};

/**
 * Owns the audio track list of the bound adapter and the one automatic selection allowed per
 * media item. An item is evaluated once, when it first lists two or more tracks outside an ad:
 * a matching preference is applied at most once, a manual choice ends evaluation, and whatever
 * the host does afterwards (restoring its own choice included) is left alone, so the player and
 * the host can never take turns.
 */
export class AudioTrackController {
  private adapter: MediaFeaturesAdapter | null = null;
  /** Retires notifications and selection results from an earlier binding or reset. */
  private generation = 0;
  private list: AudioTrackList | null = null;
  /** The item the decision below belongs to; an id the host reports survives element resets. */
  private itemKey: string | null = null;
  private evaluated = false;
  private stopObserving = () => {};
  private disposed = false;

  constructor(private readonly options: AudioTrackOptions) {}

  bind(adapter: MediaFeaturesAdapter): void {
    if (this.disposed) return;
    this.stopObserving();
    this.adapter = adapter;
    this.generation += 1;
    let cleanup: (() => void) | undefined;
    try {
      // Rebinding stops this subscription; the identity check covers a notification already queued.
      cleanup = adapter.observeAudioTracks?.(() => {
        if (this.adapter === adapter) this.refresh();
      });
    } catch { /* Audio observation is optional. */ }
    this.stopObserving = () => {
      const stop = cleanup;
      cleanup = undefined;
      try { stop?.(); } catch { /* Release the subscription once. */ }
    };
    this.refresh();
  }

  /** Media was invalidated: forget the list and reject results for the previous one. */
  reset(): void {
    if (this.disposed) return;
    this.generation += 1;
    this.list = null;
    this.refresh();
  }

  /** Tracks offered for the current item; none while blocked, as a choice would not reach it. */
  tracks(): readonly AudioTrack[] {
    return this.list && !this.list.blocked ? this.list.tracks : [];
  }

  refresh(): void {
    if (this.disposed) return;
    let list: AudioTrackList | null = null;
    try { list = this.adapter?.listAudioTracks?.() ?? null; } catch { list = null; }
    const key = list?.mediaId ?? `generation:${this.generation}`;
    if (key !== this.itemKey) {
      this.itemKey = key;
      this.evaluated = false;
    }
    this.list = list;
    this.options.onChange();
    this.autoApply();
  }

  /** A viewer's choice: it ends automatic selection for this item and, once accepted, becomes the service's preference. */
  async select(id: string): Promise<boolean> {
    const track = this.tracks().find(candidate => candidate.id === id);
    if (!track) return false;
    this.evaluated = true;
    if (!await this.apply(id)) return false;
    const preference = audioPreferenceForTrack(track);
    if (preference !== null) this.options.onPreferenceChange?.(preference);
    return true;
  }

  private offers(id: string): boolean {
    return this.tracks().some(track => track.id === id);
  }

  private autoApply(): void {
    const list = this.list;
    if (this.evaluated || !list || list.blocked || list.tracks.length < 2) return;
    this.evaluated = true;
    const target = pickPreferredAudioTrack(list.tracks, this.options.preference(), this.options.locales());
    if (target && !target.selected) void this.apply(target.id);
  }

  private async apply(id: string): Promise<boolean> {
    const adapter = this.adapter;
    const list = this.list;
    if (this.disposed || !adapter?.selectAudioTrack || !list || !this.offers(id)) return false;
    const generation = this.generation;
    const key = this.itemKey;
    let ok = false;
    try { ok = await adapter.selectAudioTrack(id, list.mediaId); } catch { ok = false; }
    // A late answer for an earlier item or adapter must not repaint the current one.
    if (this.disposed || generation !== this.generation || adapter !== this.adapter || key !== this.itemKey) return false;
    this.refresh();
    return ok;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.stopObserving();
    this.adapter = null;
    this.list = null;
  }
}
