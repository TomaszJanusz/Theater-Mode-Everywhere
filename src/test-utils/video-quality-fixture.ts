import { applyAccentColorPreset } from '../accentTheme';
import type { DisposableScope } from '../core/disposable-scope';
import type { VideoQualityMenuHost, VideoQualitySource, VideoQualityState } from '../core/video-quality';
import { ChoiceMenu } from '../ui/cc-menu';
import { applyUiDirection, t } from '../ui/messages';
import { createPlayerSettings } from '../ui/player-settings';
import { PlayerUiStore } from '../ui/store';
import { setSvgIcon } from '../ui/svg-icon';

/** Levels shaped like a logged-out YouTube 4K watch page (labels as its player names them). */
export function sampleQuality(overrides: Partial<VideoQualityState> = {}): VideoQualityState {
  const levels = [['hd2160', '2160p60', 2160], ['hd1440', '1440p60', 1440], ['hd1080', '1080p60', 1080], ['hd720', '720p60', 720],
    ['large', '480p', 480], ['medium', '360p', 360], ['small', '240p', 240], ['tiny', '144p', 144]] as const;
  return {
    mediaId: 'aqz-KE-bpKQ',
    levels: levels.map(([id, label, height]) => ({ id, label, height })),
    fixed: null,
    playing: 'hd720',
    ...overrides
  };
}

/**
 * A provider stand-in over an in-memory state. Like a real source it refuses a pick for another item or an unlisted
 * level; it records accepted picks and counts live subscriptions, so tests can see cleanup.
 */
export function fakeQualitySource(initial: VideoQualityState | null) {
  let state = initial;
  let reads = 0;
  const listeners = new Set<() => void>();
  const selections: Array<[string | null, string]> = [];
  const source: VideoQualitySource = {
    read: () => { reads += 1; return state; },
    select(id, mediaId) {
      if (!state || state.mediaId !== mediaId || (id !== null && !state.levels.some(level => level.id === id))) return false;
      selections.push([id, mediaId]);
      state = { ...state, fixed: id, playing: id ?? state.playing };
      return true;
    },
    subscribe(changed) {
      listeners.add(changed);
      return () => { listeners.delete(changed); };
    }
  };
  return {
    source,
    selections,
    reads: () => reads,
    subscriptions: () => listeners.size,
    /** The host changed (another item, an ad, a new level) and reports it. */
    update(next: VideoQualityState | null) {
      state = next;
      for (const listener of [...listeners]) listener();
    },
    /** A change the host does not report, such as the integration switched off. */
    replace(next: VideoQualityState | null) { state = next; }
  };
}

/** The production settings panel and choice list controls.ts lends the provider, with no other rows or toolbar. */
export function qualityMenuHost(scope: DisposableScope): VideoQualityMenuHost {
  const store = new PlayerUiStore();
  const settings = createPlayerSettings({
    t,
    ui: () => store.getState(),
    paintOverlay: element => { applyUiDirection(element); applyAccentColorPreset(element, 'system'); },
    actions: { setIcon: setSvgIcon, showToolbar: () => {}, updateCaptionDock: () => {} }
  }, scope);
  return { scope, settings, ChoiceMenu, setIcon: setSvgIcon };
}
