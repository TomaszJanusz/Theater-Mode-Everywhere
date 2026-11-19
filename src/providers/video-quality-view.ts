import type { VideoQualityControl, VideoQualityMenuHost, VideoQualitySource, VideoQualityState } from '../core/video-quality';
import { translateMessage } from '../i18n-runtime';
import { MENU_OPEN_EVENT } from '../ui/menu-popover';

/** Provider-only fallbacks: these bytes never join content.js. */
const FALLBACKS: Record<string, string> = {
  videoQualityLabel: 'Video quality',
  videoQualityAuto: 'Auto',
  videoQualityAutoPlaying: 'Auto ($1)',
  videoQualityBack: 'Back',
  videoQualityNone: 'No other qualities'
};
const t = (key: string, substitutions?: string[]) => translateMessage(FALLBACKS, key, substitutions);

const QUALITY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9v6M10 9v6M6 12h4M14 9h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2z"/></svg>';

/** The label Auto carries: what the host plays now, when it says. */
function autoLabel(state: VideoQualityState): string {
  const playing = state.levels.find(level => level.id === state.playing);
  return playing ? t('videoQualityAutoPlaying', [playing.label]) : t('videoQualityAuto');
}

/**
 * The settings menu's Video quality row and its nested list, from the player's own settings panel and choice list:
 * pointer and keyboard activation, Back, Escape and focus are theirs. The row shows only while the source lists a
 * choice, and every opening of the menu re-reads it, so a list that went stale (another item, an ad, the integration
 * switched off) is never offered. A pick names the item it was made for; the source refuses it for any other.
 */
export function mountVideoQualityMenu(source: VideoQualitySource, host: VideoQualityMenuHost): VideoQualityControl {
  const { settings, scope } = host;
  const button = document.createElement('button');
  button.className = 'theater-control-btn video-quality-btn';
  button.setAttribute('aria-haspopup', 'true');
  host.setIcon(button, QUALITY_ICON);
  const label = t('videoQualityLabel');
  const row = settings.addRow(button, label);
  settings.setRowHidden(button, true);

  let state: VideoQualityState | null = null;
  const menu = new host.ChoiceMenu(settings.subview, settings.button, {
    title: label,
    back: { label: t('videoQualityBack'), run: () => settings.closeSubview(true) },
    listId: 'theater-video-quality-list',
    emptyLabel: t('videoQualityNone'),
    noMatchesLabel: t('videoQualityNone'),
    closeEvents: settings.panel
  }, (id) => {
    if (state) source.select(id, state.mediaId);
    settings.close();
    update();
  });
  scope.add(() => menu.dispose());

  let lastKey = '';
  function update() {
    state = source.read();
    const key = JSON.stringify(state);
    if (key === lastKey) return;
    lastKey = key;
    settings.setRowHidden(button, !state);
    if (!state) return;
    const auto = autoLabel(state);
    const fixed = state.levels.find(level => level.id === state?.fixed);
    row.update('', fixed?.label ?? auto, [auto, ...state.levels.map(level => level.label)]);
    menu.update([
      { id: null, label: auto, active: !fixed },
      ...state.levels.map(level => ({ id: level.id, label: level.label, active: level === fixed }))
    ]);
  }

  // Host changes arrive in bursts (state, resize and quality events together); one read per frame covers them.
  let frame = 0;
  const schedule = () => {
    if (!frame) frame = scope.raf(() => { frame = 0; update(); });
  };
  scope.add(source.subscribe(schedule));
  // Dispatched before the panel positions itself, so the row is current when it is measured and focused.
  scope.listen(settings.panel, MENU_OPEN_EVENT, update);
  scope.listen(button, 'click', (event: MouseEvent) => {
    event.stopPropagation();
    update();
    if (!state) return;
    settings.openSubview(button, () => menu.firstFocus(), event.detail === 0);
    settings.subview.querySelector('.theater-cc-menu-list .active')?.scrollIntoView({ block: 'nearest' });
  });
  update();
  return { row: button };
}
