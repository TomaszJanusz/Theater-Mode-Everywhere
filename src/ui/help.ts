import { defaultShortcuts, shortcutDisplayParts } from './shortcuts';
import type { PlayerChromeContext } from './runtime-context';

export function createHelp(ctx: PlayerChromeContext) {
  function toggleHelpOverlay(): void {
    const overlay = ctx.queryPlayerUi('.theater-help-overlay') as HTMLElement | null;
    if (overlay) {
      hideHelpOverlay();
    } else {
      showHelpOverlay();
    }
  }

  function showHelpOverlay(): void {
    if (ctx.refs.helpOverlay) return;

    ctx.actions.showToolbar();

    const shortcuts = ctx.ui().shortcuts || defaultShortcuts;

    const overlay = document.createElement('div');
    overlay.className = 'theater-help-overlay';
    ctx.paintOverlay(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        hideHelpOverlay();
      }
    });

    const card = document.createElement('div');
    card.className = 'theater-help-card';

    const header = document.createElement('div');
    header.className = 'theater-help-header';

    const title = document.createElement('h3');
    title.textContent = ctx.t('keyboardShortcutsTitle');

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'theater-help-close-btn';
    closeBtn.setAttribute('aria-label', ctx.t('showHideHelp'));
    closeBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;
    closeBtn.addEventListener('click', hideHelpOverlay);

    header.appendChild(title);
    header.appendChild(closeBtn);
    card.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'theater-help-grid';

    const groups = [
      {
        title: ctx.t('generalControlsTitle'),
        items: [
          { label: ctx.t('toggleTheaterMode'), key: shortcuts.toggle },
          { label: ctx.t('exitTheaterMode'), key: shortcuts.exit },
          { label: ctx.t('cycleSwitchVideo'), key: shortcuts.cycle },
          { label: ctx.t('cycleVideoFit'), key: shortcuts.cycleFit },
          { label: ctx.t('toggleSubtitles'), key: shortcuts.toggleCaptions },
          { label: ctx.t('showHideHelp'), key: shortcuts.showHelp }
        ]
      },
      {
        title: ctx.t('playbackVolumeControlsTitle'),
        items: [
          { label: ctx.t('playPause'), key: shortcuts.playPause },
          { label: ctx.t('seekBackward5'), key: shortcuts.seekBack },
          { label: ctx.t('seekForward5'), key: shortcuts.seekForward },
          { label: ctx.t('volumeUp5'), key: shortcuts.volumeUp },
          { label: ctx.t('volumeDown5'), key: shortcuts.volumeDown }
        ]
      },
      {
        title: ctx.t('frameFullscreenPipTitle'),
        items: [
          { label: ctx.t('frameStepBackward'), key: shortcuts.frameBack },
          { label: ctx.t('frameStepForward'), key: shortcuts.frameForward },
          { label: ctx.t('toggleFullscreen'), key: shortcuts.toggleFullscreen },
          { label: ctx.t('togglePictureInPicture'), key: shortcuts.togglePiP }
        ]
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

      grid.appendChild(groupEl);
    });

    card.appendChild(grid);
    overlay.appendChild(card);
    ctx.mountPlayerUi(overlay);

    ctx.refs.helpOverlay = overlay;
    ctx.uiStore.dispatch({ type: 'SET_HELP_OPEN', value: true });
  }

  function hideHelpOverlay(): void {
    if (!ctx.refs.helpOverlay) return;
    ctx.refs.helpOverlay.remove();
    ctx.refs.helpOverlay = null;
    ctx.uiStore.dispatch({ type: 'SET_HELP_OPEN', value: false });
    ctx.actions.scheduleToolbarHide();
  }

  return { toggleHelpOverlay, showHelpOverlay, hideHelpOverlay };
}
