import { activeElementDeep } from '../accessibility';
import { createModal, type Modal } from './modal';
import { AUDIO_LABEL_KEYS, AUDIO_SETTING_NAMES } from '../audio-settings';
import { AUDIO_SHORTCUTS, defaultShortcuts, NAVIGATION_SHORTCUTS, shortcutDisplayParts } from './shortcuts';
import type { PlayerChromeContext } from './runtime-context';

export function createHelp(ctx: PlayerChromeContext) {
  let modal: Modal | null = null;

  function toggleHelpOverlay(): void {
    const overlay = ctx.queryPlayerUi('.theater-help-overlay') as HTMLElement | null;
    if (overlay) {
      hideHelpOverlay();
    } else {
      showHelpOverlay();
    }
  }

  function showHelpOverlay(): void {
    if (ctx.refs.helpOverlay?.isConnected) return;
    if (ctx.refs.helpOverlay) hideHelpOverlay(false);

    const returnFocus = activeElementDeep();
    const returnTrigger = returnFocus?.closest('.theater-settings-menu, .player-settings-btn')
      ? '.player-settings-btn'
      : returnFocus?.closest('.theater-cc-menu') ? '.cc-btn' : null;

    ctx.actions.closeTheaterPopovers();
    ctx.actions.showToolbar();

    const shortcuts = ctx.ui().shortcuts || defaultShortcuts;
    const grid = document.createElement('div');
    grid.className = 'theater-help-grid';
    const theaterColumn = document.createElement('div');
    const playbackColumn = document.createElement('div');
    theaterColumn.className = playbackColumn.className = 'theater-help-column';

    const groups = [
      {
        title: ctx.t('theaterFullscreenPipTitle'),
        items: [
          { label: ctx.t('toggleTheaterMode'), key: shortcuts.toggle },
          { label: ctx.t('exitTheaterMode'), key: shortcuts.exit },
          { label: ctx.t('toggleFullscreen'), key: shortcuts.toggleFullscreen },
          { label: ctx.t('togglePictureInPicture'), key: shortcuts.togglePiP }
        ]
      },
      {
        title: ctx.t('playerControlsTitle'),
        items: [
          { label: ctx.t('cycleSwitchVideo'), key: shortcuts.cycle },
          { label: ctx.t('cycleVideoFit'), key: shortcuts.cycleFit },
          { label: ctx.t('cyclePictureLayout'), key: shortcuts.cycleLayout },
          { label: ctx.t('toggleNativeChat'), key: shortcuts.toggleChat },
          { label: ctx.t('toggleSubtitles'), key: shortcuts.toggleCaptions },
          { label: ctx.t('increaseSubtitleSize'), key: shortcuts.increaseCaptionSize },
          { label: ctx.t('decreaseSubtitleSize'), key: shortcuts.decreaseCaptionSize },
          { label: ctx.t('toggleControlsPin'), key: shortcuts.toggleControlsPin },
          { label: ctx.t('showHideHelp'), key: shortcuts.showHelp }
        ]
      },
      {
        title: ctx.t('playbackVolumeControlsTitle'),
        items: [
          { label: ctx.t('playPause'), key: shortcuts.playPause },
          { label: ctx.t('previousVideo'), key: shortcuts.previousVideo },
          { label: ctx.t('nextVideo'), key: shortcuts.nextVideo },
          { label: ctx.t('seekBackward5'), key: shortcuts.seekBack },
          { label: ctx.t('seekForward5'), key: shortcuts.seekForward },
          { label: ctx.t('frameStepBackward'), key: shortcuts.frameBack },
          { label: ctx.t('frameStepForward'), key: shortcuts.frameForward },
          { label: ctx.t('volumeUp5'), key: shortcuts.volumeUp },
          { label: ctx.t('volumeDown5'), key: shortcuts.volumeDown },
          { label: ctx.t('toggleMute'), key: shortcuts.toggleMute }
        ]
      },
      {
        title: ctx.t('settingsSectionAudio'),
        items: [
          { label: ctx.t('volumeBoostLabel'), key: shortcuts.toggleVolumeBoost },
          ...AUDIO_SETTING_NAMES.map((name) => ({ label: ctx.t(AUDIO_LABEL_KEYS[name]), key: shortcuts[AUDIO_SHORTCUTS[name]] }))
        ]
      },
      {
        title: ctx.t('navigationGroupTitle'),
        items: NAVIGATION_SHORTCUTS.map((name) => ({ label: ctx.t(name), key: shortcuts[name] }))
      }
    ];

    groups.forEach(group => {
      const groupEl = document.createElement('div');
      groupEl.className = 'theater-help-group';

      const groupTitle = document.createElement('div');
      groupTitle.className = 'theater-help-group-title';
      groupTitle.textContent = group.title;
      groupEl.appendChild(groupTitle);

      group.items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'theater-help-row';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'theater-help-label';
        labelSpan.textContent = item.label;

        const keyWrapper = document.createElement('div');
        keyWrapper.className = 'theater-help-key-wrapper';
        keyWrapper.dir = 'ltr';

        const keys = shortcutDisplayParts(item.key);
        if (!keys.length) keyWrapper.textContent = ctx.t('shortcutUnassigned');
        keys.forEach((k, idx) => {
          if (idx > 0) {
            keyWrapper.appendChild(document.createTextNode(' + '));
          }
          const kbd = document.createElement('kbd');
          kbd.textContent = k;
          keyWrapper.appendChild(kbd);
        });

        row.appendChild(labelSpan);
        row.appendChild(keyWrapper);
        groupEl.appendChild(row);
      });

      (groups.indexOf(group) < 2 ? theaterColumn : playbackColumn).appendChild(groupEl);
    });
    grid.append(theaterColumn, playbackColumn);

    modal = createModal({
      title: ctx.t('keyboardShortcutsTitle'),
      closeLabel: ctx.t('dialogClose'),
      content: grid,
      size: 'wide',
      scrollable: true,
      initialFocus: 'close',
      dismissShortcut: shortcuts.showHelp,
      mount: ctx.mountPlayerUi,
      decorate: overlay => { overlay.classList.add('theater-help-overlay'); ctx.paintOverlay(overlay); },
      returnFocus: () => returnTrigger ? ctx.queryPlayerUi<HTMLElement>(returnTrigger) : returnFocus,
      onClose: () => {
        modal = null;
        ctx.refs.helpOverlay = null;
        ctx.uiStore.dispatch({ type: 'SET_HELP_OPEN', value: false });
        ctx.actions.scheduleToolbarHide();
      }
    });
    ctx.refs.helpOverlay = modal.overlay;
    ctx.uiStore.dispatch({ type: 'SET_HELP_OPEN', value: true });
  }

  function hideHelpOverlay(restoreFocus = true): void {
    if (modal) modal.close(false, restoreFocus);
    else {
      ctx.refs.helpOverlay = null;
      ctx.uiStore.dispatch({ type: 'SET_HELP_OPEN', value: false });
    }
  }

  return { toggleHelpOverlay, showHelpOverlay, hideHelpOverlay };
}
