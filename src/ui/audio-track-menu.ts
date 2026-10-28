import type { DisposableScope } from '../core/disposable-scope';
import type { AudioTrackResult, IndexedAudioTrack } from '../media-features/audio-tracks';
import type { AudioTrack } from '../media-features/types';

import { ChoiceMenu } from './cc-menu';
import type { createPlayerSettings } from './player-settings';
import type { AudioTrackHudReport } from './runtime-context';

type Translate = (key: string, substitutions?: string | string[]) => string;
type PlayerSettings = ReturnType<typeof createPlayerSettings>;

const AUDIO_TRACK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10v4"/><path d="M7 6v12"/><path d="M11 3v18"/><path d="M15 8v8"/><path d="M19 11v2"/></svg>`;

function languageName(tag: string, locale: string): string {
  if (!tag) return '';
  try {
    return new Intl.DisplayNames([locale, 'en'], { type: 'language', fallback: 'none' }).of(tag) ?? '';
  } catch {
    return '';
  }
}

/** The host's label when it has one; otherwise the language name, marked when the track is not plain audio. */
export function audioTrackDisplayLabel(track: AudioTrack, index: number, t: Translate, locale: string): string {
  if (track.label) return track.label;
  const name = languageName(track.languageTag, locale) || t('trackLabel', String(index + 1));
  if (track.kind === 'description') return t('audioTrackDescription', name);
  if (track.kind === 'commentary') return t('audioTrackCommentary', name);
  return name;
}

/** The language notice's audio lines for a result, naming tracks as the menu does. */
export function audioTrackHudReport(result: AudioTrackResult, t: Translate, locale: string, isDefault = false): AudioTrackHudReport {
  const label = ({ track, index }: IndexedAudioTrack) => audioTrackDisplayLabel(track, index, t, locale);
  return {
    playing: result.playing && label(result.playing),
    ...(result.refused === undefined ? {} : { refused: result.refused && label(result.refused) }),
    ...(isDefault ? { isDefault } : {})
  };
}

/**
 * The Audio track row and its nested list. Both read only the shared track contract; the row
 * shows with two or more tracks, and choosing one closes the menu like a subtitle choice.
 */
export function mountAudioTrackMenu(options: {
  settings: PlayerSettings;
  scope: DisposableScope;
  t: Translate;
  locale: string;
  setIcon: (element: HTMLElement, svg: string) => void;
  tracks: () => readonly AudioTrack[];
  select: (id: string) => Promise<boolean>;
  /** This service's saved audio language, if any. */
  preference: () => string | null;
  /** Forgets it, so the service chooses again from the next item. */
  resetPreference: () => void;
}): { update: () => void } {
  const { settings, scope, t, locale } = options;
  const button = document.createElement('button');
  button.className = 'theater-control-btn audio-track-btn';
  button.setAttribute('aria-haspopup', 'true');
  options.setIcon(button, AUDIO_TRACK_ICON);
  const row = settings.addRow(button, t('audioTrackLabel'), 'audioTracks', 'playerAudioTrack');
  settings.setRowHidden(button, true);
  const menu = new ChoiceMenu(settings.subview, settings.button, {
    title: t('audioTrackLabel'),
    back: { label: t('audioTrackBack'), run: () => settings.closeSubview(true) },
    // Like choosing Off for subtitles, this is how a saved choice is undone; it keeps the current track.
    action: { label: t('audioTrackServiceDefault'), className: 'theater-audio-track-reset', run: () => { options.resetPreference(); update(); } },
    listId: 'theater-audio-track-list',
    searchLabel: t('searchAudioTracks'),
    emptyLabel: t('noAudioTracks'),
    noMatchesLabel: t('subtitleNoMatches'),
    closeEvents: settings.panel
  }, (id) => {
    if (id !== null) void options.select(id).then(update);
    settings.close();
  });
  scope.add(() => menu.dispose());

  let lastKey = '';
  const update = () => {
    const tracks = options.tracks();
    const labels = tracks.map((track, index) => audioTrackDisplayLabel(track, index, t, locale));
    const saved = options.preference() !== null;
    const key = JSON.stringify([saved, tracks.map((track, index) => [track.id, labels[index], track.selected])]);
    if (key === lastKey) return;
    lastKey = key;
    const selected = tracks.findIndex(track => track.selected);
    settings.setRowHidden(button, tracks.length < 2);
    menu.setActionHidden(!saved);
    row.update('', selected >= 0 ? labels[selected] : undefined, labels);
    menu.update(tracks.map((track, index) => ({ id: track.id, label: labels[index], language: track.languageTag, active: track.selected })));
  };
  scope.listen(button, 'click', (event: MouseEvent) => {
    event.stopPropagation();
    update();
    settings.openSubview(button, () => menu.firstFocus());
    settings.subview.querySelector('.theater-cc-menu-list .active')?.scrollIntoView({ block: 'nearest' });
  });
  update();
  return { update };
}
