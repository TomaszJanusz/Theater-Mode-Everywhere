import type { PlaylistPanelItem, PlaylistPanelSnapshot, PlaylistPanelSource } from '../core/playlist-panel';
import { mountPlaylistView } from '../providers/playlist-panel-view';

const TITLES = [
  'Morning light over the harbour', 'How a mechanical watch keeps time', 'Ten minutes of rain on a tin roof',
  'Building a bookshelf without screws, start to finish, with every mistake left in',
  'The long road north', 'Street food at midnight', 'Why bridges sing in the wind', 'A quiet walk through the old town',
  'Restoring a 1970s synthesizer', 'Tide pools at low water', 'Learning to juggle in a week', 'The last ferry home'
];
const CHANNELS = ['Harbour Films', 'Tick & Tock', 'Slow Sounds', 'Workshop Notes'];

/** A flat colour per item: deterministic offline thumbnails for stories and shots. */
function thumbnail(index: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="hsl(${(index * 47) % 360} 45% 42%)"/><circle cx="12" cy="3" r="1.6" fill="hsl(${(index * 47 + 180) % 360} 60% 70%)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** A synthetic list shaped like YouTube's panel data: positions, durations, bylines and one current item. */
export function samplePlaylist(options: { count?: number; current?: number; total?: number | null; title?: string } = {}): PlaylistPanelSnapshot {
  const count = options.count ?? 12;
  const current = options.current ?? 3;
  const items: PlaylistPanelItem[] = Array.from({ length: count }, (_, index) => ({
    key: `item-${index + 1}`,
    position: index + 1,
    title: TITLES[index % TITLES.length],
    byline: CHANNELS[index % CHANNELS.length],
    duration: `${3 + (index * 7) % 40}:${String((index * 13) % 60).padStart(2, '0')}`,
    imageUrl: thumbnail(index),
    current: index + 1 === current,
    playable: index !== 7
  }));
  return { title: options.title ?? 'Slow travel and small crafts', owner: 'Harbour Films', total: options.total === undefined ? count : options.total, items };
}

/**
 * A provider stand-in: the production shared view over an in-memory list. It records activations and how many
 * host subscriptions are live, so tests can see that observation is scoped to an opening.
 */
export function fakePlaylistSource(initial: PlaylistPanelSnapshot | null) {
  let snapshot = initial;
  let available = initial !== null;
  const listeners = new Set<() => void>();
  const activations: string[] = [];
  let reads = 0;
  const data = {
    read: () => { reads += 1; return snapshot; },
    activate(key: string) {
      const item = snapshot?.items.find(entry => entry.key === key);
      if (!item?.playable || item.current) return false;
      activations.push(key);
      return true;
    },
    subscribe(changed: () => void) {
      listeners.add(changed);
      return () => { listeners.delete(changed); };
    }
  };
  const source: PlaylistPanelSource = {
    available: () => available,
    mount: (panel, scope, close) => mountPlaylistView(data, panel, scope, close)
  };
  return {
    source,
    activations,
    reads: () => reads,
    subscriptions: () => listeners.size,
    /** The host replaced its list (a new current item, SPA navigation) and reports it. */
    update(next: PlaylistPanelSnapshot | null) {
      snapshot = next;
      for (const listener of [...listeners]) listener();
    },
    setAvailable(value: boolean) { available = value; }
  };
}
