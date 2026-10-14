import { observeChromeVisibility } from './chrome-visibility';
import { emptyPlaylistNav, type PlaylistNavState } from '../playlist-nav';
import { observeProviderClock, readProviderClock } from '../providers/timeline';
import { captionPreferenceHost } from '../media-features/caption-preference';
import { MediaFeaturesController } from '../media-features/controller';
import { observeProviderMediaChanges, refreshProviderAfterElementReset } from '../providers/media-events';
import { createServiceActions } from '../providers/service-actions';
import { PREVIEW_DISPLAY_WIDTH } from '../media-features/preview-display';
import { DisposableScope } from '../core/disposable-scope';
import type { PlayerCommand } from '../core/player-session';
import { togglePictureInPicture } from './picture-in-picture';
import { createFullscreenRecovery } from './fullscreen-recovery';
import { waitForSeekCompletion } from './seek-completion';
import {
  isAtLiveEdge,
  isVideoAtLiveEdge,
  MAX_LIVE_DVR_SECONDS,
  playbackWindow,
  presentPlaybackWindow,
  ratioToTime,
  seekToLive,
  timeToRatio,
  displayMediaTime,
  clearPendingMediaSeek
} from '../playback-window';
import { selectSwitchableVideos } from '../switchable-videos';
import { CURSOR_HIDDEN_CLASS } from './toolbar';
import { CONTROLS_VISIBILITY_ICON } from './controls-visibility';
import { AUDIO_SETTING_ICONS, PICTURE_LAYOUT_ICON, VOLUME_BOOST_ICONS } from './hud';
import { AUDIO_SHORTCUTS } from './shortcuts';
import { AUDIO_BLOCK_KEYS, AUDIO_LABEL_KEYS, AUDIO_SETTING_NAMES, audioLevelLabelKey } from '../audio-settings';
import { bindMenuPopover } from './menu-popover';
import { armPictureDismiss, armPictureDismissOnLeave, clearPictureDismiss, playerChromeExpanded } from './picture-dismiss';
import { mountServiceActionCta } from './service-actions';
import { createPlayerSettings } from './player-settings';
import { mountNativeChatControls, nativeChatState } from './chat';
import { clockLabels, renderLiveBadge, renderTimeReadout } from './time-readout';
import type { ButtonTooltipBinder } from './button-tooltip';
import type { PlayerChromeContext } from './runtime-context';
import { coercePlaybackSurface, nativeVideoOf, volumeCeiling, type PlaybackSurface } from '../playback-surface';

export interface ExtendedHTMLDivElement extends HTMLDivElement {
  _videoListenersCleanup?: () => void;
  /** Called as the bar becomes visible, to present the current playback state. */
  _syncPlaybackChrome?: () => void;
  _mediaFeatures?: MediaFeaturesController;
}

export function createControls(
  ctx: PlayerChromeContext,
  bindCustomTooltip: ButtonTooltipBinder,
  onDestroy?: () => void
) {
  const session = ctx.session;
  const refs = ctx.refs;
  const ui = ctx.ui;
  const t = ctx.t;
  const mountPlayerUi = ctx.mountPlayerUi;
  const queryPlayerUi = ctx.queryPlayerUi;
  const destroyPlayerUi = ctx.destroyPlayerUi;
  const eventPathIncludes = ctx.eventPathIncludes;
  const eventPathMatches = ctx.eventPathMatches;
  const paintOverlay = ctx.paintOverlay;
  const showToolbar = (event?: Event) => ctx.actions.showToolbar(event);
  const updateCaptionDock = (immediate?: boolean | Event) => ctx.actions.updateCaptionDock(immediate === true);
  const closeTheaterPopovers = () => ctx.actions.closeTheaterPopovers();
  const blurMouseToggle = (event: MouseEvent, button: HTMLElement) => ctx.actions.blurMouseToggle(event, button);
  const setIcon = (el: HTMLElement, svg: string) => ctx.actions.setIcon(el, svg);
  const escapeHtml = (s: string) => ctx.actions.escapeHtml(s);
  const applyVolumeAndBoost = (video: PlaybackSurface, slider: number) => ctx.actions.applyVolumeAndBoost(video, slider);
  const rememberAudibleVolume = (video: PlaybackSurface, volume: number) => ctx.actions.rememberAudibleVolume(video, volume);
  const isVideoSilent = (video: PlaybackSurface) => ctx.actions.isVideoSilent(video);
  const persistCaptionPreference = (pref: Parameters<typeof ctx.actions.persistCaptionPreference>[0]) => {
    ctx.actions.persistCaptionPreference(pref);
  };
  const persistCaptionStyle = (style: Parameters<typeof ctx.actions.persistCaptionStyle>[0]) => {
    ctx.actions.persistCaptionStyle(style);
  };
  const showCaptionHud = (payload: Parameters<typeof ctx.actions.showCaptionHud>[0]) => ctx.actions.showCaptionHud(payload);
  const syncContentTitle = (title: string | null) => ctx.actions.syncContentTitle(title);
  const executeCommand = (command: PlayerCommand) => ctx.actions.executeCommand(command);
  const exitTheaterMode = () => ctx.actions.exitTheaterMode();
  const showHelpOverlay = () => ctx.actions.showHelpOverlay();
  const findAllVideosDeep = (root?: Document | ShadowRoot) => ctx.actions.findAllVideosDeep(root);
  const seekHostTime = (video: PlaybackSurface, time: number) => ctx.actions.seekHostTime(video, time);
  // Creates unified bottom player controls
  function createCustomControls(media: HTMLVideoElement | PlaybackSurface): void {
    const video = coercePlaybackSurface(media);
    const native = nativeVideoOf(video);
    let volumeMax = volumeCeiling(video, ui().volumeBoost);
    destroyCustomControls();

    const controlsScope = new DisposableScope();
    let gestureScope: DisposableScope | null = null;
    let seekCompletionScope: DisposableScope | null = null;

    const wrapper = document.createElement('div') as ExtendedHTMLDivElement;
    wrapper.className = 'theater-controls-wrapper';
    paintOverlay(wrapper);

    // Create loading indicator
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'theater-loading-indicator';
    paintOverlay(loadingIndicator);
  
    const loadingSpinner = document.createElement('div');
    loadingSpinner.className = 'theater-loading-spinner';
  
    loadingIndicator.appendChild(loadingSpinner);
  
    mountPlayerUi(loadingIndicator);

    // Prevent event propagation so clicking controls doesn't trigger parent actions or play/pause
    wrapper.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    wrapper.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    });
    wrapper.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
    wrapper.addEventListener('pointermove', updateCaptionDock);
    wrapper.addEventListener('transitionend', updateCaptionDock);
    wrapper.addEventListener('pointerleave', updateCaptionDock);

    // 1. Scrubber (Progress bar)
    const scrubberContainer = document.createElement('div');
    scrubberContainer.className = 'theater-scrubber-container';

    const scrubberTrack = document.createElement('div');
    scrubberTrack.className = 'theater-scrubber-track';

    const scrubberBuffer = document.createElement('div');
    scrubberBuffer.className = 'theater-scrubber-buffer';

    const scrubberFill = document.createElement('div');
    scrubberFill.className = 'theater-scrubber-fill';

    const scrubberHandle = document.createElement('div');
    scrubberHandle.className = 'theater-scrubber-handle';

    scrubberTrack.appendChild(scrubberBuffer);
    scrubberTrack.appendChild(scrubberFill);
    scrubberTrack.appendChild(scrubberHandle);
    scrubberContainer.appendChild(scrubberTrack);

    const tooltip = document.createElement('div');
    tooltip.className = 'theater-scrubber-tooltip theater-backdrop-hint';

    const preview = document.createElement('div');
    preview.className = 'theater-scrubber-preview';
    preview.hidden = true;
    preview.style.width = `${PREVIEW_DISPLAY_WIDTH}px`;
    preview.style.backgroundRepeat = 'no-repeat';
    const chapterTitle = document.createElement('div');
    chapterTitle.className = 'theater-scrubber-chapter-title';
    chapterTitle.hidden = true;
    const timeLabel = document.createElement('div');
    timeLabel.className = 'theater-scrubber-time';
    tooltip.append(preview, chapterTitle, timeLabel);

    // Compare requested values: CSSOM can normalize URLs and fractional pixels.
    const previewStyles = { height: '', backgroundImage: '', backgroundPosition: '', backgroundSize: '' };
    const setPreviewStyle = (property: keyof typeof previewStyles, value: string) => {
      if (previewStyles[property] === value) return;
      previewStyles[property] = value;
      preview.style[property] = value;
    };
    let tooltipLeft = '';

    // 2. Control Row
    const controlsRow = document.createElement('div');
    controlsRow.className = 'theater-controls-row';

    // Left Controls Section
    const leftSec = document.createElement('div');
    leftSec.className = 'theater-controls-left';

    // Play/Pause Button
    const playPauseBtn = document.createElement('button');
    playPauseBtn.className = 'theater-control-btn play-pause-btn';
  
    bindCustomTooltip(playPauseBtn, () => {
      const action = video.paused ? t('play') : t('pause');
      return `${action} <kbd>${ui().shortcuts.playPause}</kbd>`;
    });

    const playIcon = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
    `;
    const pauseIcon = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <rect x="6" y="4" width="4" height="16" rx="1"></rect>
        <rect x="14" y="4" width="4" height="16" rx="1"></rect>
      </svg>
    `;

    setIcon(playPauseBtn, video.paused ? playIcon : pauseIcon);
    playPauseBtn.addEventListener('click', () => {
      executeCommand({ type: 'PLAY_PAUSE' });
    });

    const previousIcon = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <rect x="4" y="3" width="2.2" height="18" rx="0.4"></rect>
        <path d="M19 4 8.5 12 19 20z"></path>
      </svg>
    `;
    const nextIcon = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <path d="M5 4 15.5 12 5 20z"></path>
        <rect x="17.8" y="3" width="2.2" height="18" rx="0.4"></rect>
      </svg>
    `;

    const previousBtn = document.createElement('button');
    previousBtn.type = 'button';
    previousBtn.className = 'theater-control-btn playlist-prev-btn';
    previousBtn.hidden = true;
    setIcon(previousBtn, previousIcon);
    let playlistState: PlaylistNavState = emptyPlaylistNav();
    const playlistPreview = (direction: 'previous' | 'next') => {
      const available = playlistState;
      if (direction === 'previous' && available.previousRestarts) return null;
      return direction === 'previous' ? available.previousPreview : available.nextPreview;
    };
    const playlistActionName = (direction: 'previous' | 'next') => {
      if (direction === 'previous' && playlistState.previousRestarts) {
        return t('backToStart');
      }
      return t(direction === 'previous' ? 'previousVideo' : 'nextVideo');
    };
    const playlistShortcutText = (direction: 'previous' | 'next') => {
      const shortcut = direction === 'previous' ? ui().shortcuts.previousVideo : ui().shortcuts.nextVideo;
      const keys = shortcut.split('+').filter(Boolean).map((part) => `<kbd>${part}</kbd>`).join('+');
      return `${playlistActionName(direction)} ${keys}`;
    };
    const playlistLabel = (direction: 'previous' | 'next') => {
      const preview = playlistPreview(direction);
      const name = playlistActionName(direction);
      return preview ? `${name}: ${preview.title}` : name;
    };
    bindCustomTooltip(previousBtn, () => playlistShortcutText('previous'), () => playlistPreview('previous'));
    previousBtn.addEventListener('click', () => {
      ctx.actions.activatePlaylistStep('previous');
    });

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'theater-control-btn playlist-next-btn';
    nextBtn.hidden = true;
    setIcon(nextBtn, nextIcon);
    bindCustomTooltip(nextBtn, () => playlistShortcutText('next'), () => playlistPreview('next'));
    nextBtn.addEventListener('click', () => {
      ctx.actions.activatePlaylistStep('next');
    });

    const syncPlaylistButtons = (available: PlaylistNavState) => {
      playlistState = available;
      if (previousBtn.hidden === available.previous) previousBtn.hidden = !available.previous;
      if (nextBtn.hidden === available.next) nextBtn.hidden = !available.next;
      for (const [button, direction] of [[previousBtn, 'previous'], [nextBtn, 'next']] as const) {
        const label = playlistLabel(direction);
        if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
      }
      ctx.actions.requestParentPlaylistNav(available);
    };
    controlsScope.add(ctx.actions.subscribePlaylistNavigation(syncPlaylistButtons));
    let barWasVisible = ui().toolbarVisible;
    controlsScope.add(ctx.uiStore.subscribe(state => {
      if (state.toolbarVisible && !barWasVisible) syncPlaylistButtons(ctx.actions.playlistNavigationAvailable());
      barWasVisible = state.toolbarVisible;
    }));

    // Volume Container
    const volumeContainer = document.createElement('div');
    volumeContainer.className = 'theater-volume-container theater-popover';
    volumeContainer.addEventListener('pointerenter', updateCaptionDock);
    volumeContainer.addEventListener('pointerleave', (event) => {
      armPictureDismissOnLeave(event, volumeContainer);
      updateCaptionDock();
    });

    const volumeBtn = document.createElement('button');
    volumeBtn.className = 'theater-control-btn volume-btn';

    const volumePanel = document.createElement('div');
    volumePanel.className = 'theater-volume-panel';

    const volumeTooltip = document.createElement('div');
    volumeTooltip.className = 'theater-volume-tooltip-vertical';

    const volumeSliderWrapper = document.createElement('div');
    volumeSliderWrapper.className = 'theater-vertical-slider-wrapper';

    const volumeSlider = document.createElement('input');
    volumeSlider.type = 'range';
    volumeSlider.className = 'theater-volume-slider theater-vertical-slider';
    volumeSlider.min = '0';
    volumeSlider.step = '0.05';
  
    if (video.volume > 0) rememberAudibleVolume(video, video.volume);
    const initialLogical = video.logicalVolume !== undefined
      ? video.logicalVolume
      : (isVideoSilent(video) ? 0 : video.volume);
    volumeSlider.value = String(initialLogical);

    const volumeTick100 = document.createElement('div');
    volumeTick100.className = 'volume-tick-100-vertical';
    const applyVolumeMax = () => {
      volumeSlider.max = volumeMax.toFixed(1);
      volumeTick100.style.display = volumeMax <= 1 ? 'none' : '';
    };
    applyVolumeMax();

    volumeSliderWrapper.appendChild(volumeSlider);
    volumeSliderWrapper.appendChild(volumeTick100);
    volumePanel.appendChild(volumeTooltip);
    volumePanel.appendChild(volumeSliderWrapper);

    const volHighIcon = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      </svg>
    `;
    const volLowIcon = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      </svg>
    `;
    const volMutedIcon = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <line x1="23" y1="9" x2="17" y2="15"></line>
        <line x1="17" y1="9" x2="23" y2="15"></line>
      </svg>
    `;

    const updateVolumeIcon = () => {
      const logicalVol = video.muted ? 0 : (video.logicalVolume !== undefined ? video.logicalVolume : video.volume);
      volumeBtn.classList.toggle('boosted', logicalVol > 1.0 && native?.dataset.theaterBoostReady === 'true');
      if (video.muted || logicalVol === 0) {
        setIcon(volumeBtn, volMutedIcon);
      } else if (logicalVol < 0.5) {
        setIcon(volumeBtn, volLowIcon);
      } else {
        setIcon(volumeBtn, volHighIcon);
      }
    };
    updateVolumeIcon();

    const updateVolumeSliderFill = () => {
      const logicalVol = video.muted ? 0 : (video.logicalVolume !== undefined ? video.logicalVolume : video.volume);
      const fillPct = (logicalVol / volumeMax) * 100;
      const isBoosted = logicalVol > 1.0;
      const activeColor = isBoosted ? 'var(--theater-volume-boost-color)' : 'var(--accent-color, #6366f1)';
      const grad = `linear-gradient(to right, ${activeColor} 0%, ${activeColor} ${fillPct}%, rgba(255, 255, 255, 0.2) ${fillPct}%, rgba(255, 255, 255, 0.2) 100%)`;
      volumeSlider.style.setProperty('background', grad, 'important');
      if (isBoosted) {
        volumeSlider.classList.add('boosted');
      } else {
        volumeSlider.classList.remove('boosted');
      }
    };
    updateVolumeSliderFill();

    const updateVolumeTooltip = () => {
      const logicalVol = video.muted ? 0 : (video.logicalVolume !== undefined ? video.logicalVolume : video.volume);
      if (logicalVol <= 1.0) {
        volumeTooltip.textContent = `${Math.round(logicalVol * 100)}%`;
        volumeTooltip.style.color = '#f8fafc';
      } else {
        const pct = Math.round(100 + (logicalVol - 1.0) * 400);
        volumeTooltip.textContent = `${pct}%`;
        volumeTooltip.style.color = 'var(--theater-volume-boost-color)';
      }
    };
    updateVolumeTooltip();

    const onBoostReady = () => {
      updateVolumeIcon();
      updateVolumeSliderFill();
      updateVolumeTooltip();
    };
    window.addEventListener('theater-everywhere-boost-ready', onBoostReady);
    controlsScope.add(ctx.uiStore.subscribe(() => {
      const next = volumeCeiling(video, ui().volumeBoost);
      if (next === volumeMax) return;
      volumeMax = next;
      applyVolumeMax();
      updateVolumeSliderFill();
    }));

    volumeBtn.addEventListener('click', (event) => {
      ctx.actions.toggleVideoMute(video);
      blurMouseToggle(event, volumeBtn);
    });

    volumeSlider.addEventListener('input', (e) => {
      let val = parseFloat((e.target as HTMLInputElement).value);
      if (Math.abs(val - 1.0) <= 0.05) {
        val = 1.0;
        volumeSlider.value = '1.0';
      }
      video.logicalVolume = val;
      rememberAudibleVolume(video, val);
      if (val > 0 && video.muted) {
        video.muted = false;
      }
      applyVolumeAndBoost(video, val);
      updateVolumeIcon();
      updateVolumeSliderFill();
      updateVolumeTooltip();
    });

    volumeContainer.appendChild(volumeBtn);
    volumeContainer.appendChild(volumePanel);

    // Elapsed sits left of the scrubber. The trailing clock sits on its right
    // and toggles between time remaining and duration.
    const elapsedReadout = document.createElement('span');
    elapsedReadout.className = 'theater-time-display theater-time-elapsed';
    elapsedReadout.dir = 'ltr';

    const endReadout = document.createElement('button');
    endReadout.type = 'button';
    endReadout.className = 'theater-time-display theater-time-end';
    endReadout.dir = 'ltr';
    renderTimeReadout(elapsedReadout, '0:00', false);
    renderTimeReadout(endReadout, '-0:00', false);

    type ChromePlayback = ReturnType<typeof playbackWindow>;
    let stableWindow: ChromePlayback | null = null;
    const playbackForChrome = (): ChromePlayback | null => {
      const next = playbackWindow(video);
      const presented = presentPlaybackWindow(stableWindow, next);
      if (presented.live || presented.seekable) stableWindow = presented;
      if (!(next.live || next.seekable) && stableWindow) return null;
      return presented;
    };

    const formatTime = (secs: number): string => {
      const total = stableWindow?.end ?? secs;
      const span = Number.isFinite(total) && total > 0 && total !== Infinity ? total : secs;
      if (isNaN(secs) || !isFinite(secs)) secs = 0;
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = Math.floor(secs % 60);
      const sStr = String(s).padStart(2, '0');
      if (span >= 3600) return `${h}:${String(m).padStart(2, '0')}:${sStr}`;
      if (span >= 600) return `${String(m).padStart(2, '0')}:${sStr}`;
      return `${m}:${sStr}`;
    };

    let showTotalTime = false;
    elapsedReadout.addEventListener('click', (e) => {
      e.stopPropagation();
      const playback = playbackForChrome();
      if (!playback?.live || !playback.seekable || !native) return;
      seekToLive(native);
    });
    endReadout.addEventListener('click', (e) => {
      e.stopPropagation();
      const playback = playbackForChrome();
      if (!playback || playback.live) return;
      showTotalTime = !showTotalTime;
      updatePlaybackChrome(true);
    });

    let liveChromeKey = '';
    const syncLiveChrome = (playback: ChromePlayback) => {
      const locked = playback.live && !playback.seekable;
      const canJumpToLive = playback.live && playback.seekable;
      const behindLive = canJumpToLive && !isVideoAtLiveEdge(video, playback);
      const key = `${playback.live}:${locked}:${behindLive}:${canJumpToLive}`;
      if (key === liveChromeKey) return { live: playback.live, behindLive, canJumpToLive };
      liveChromeKey = key;
      elapsedReadout.classList.toggle('theater-time-live', playback.live);
      elapsedReadout.classList.toggle('theater-time-live-behind', behindLive);
      elapsedReadout.classList.toggle('theater-time-live-jump', behindLive);
      elapsedReadout.style.cursor = playback.live && canJumpToLive ? 'pointer' : '';
      scrubberContainer.classList.toggle('theater-scrubber-live', playback.live);
      scrubberContainer.classList.toggle('theater-scrubber-live-locked', locked);
      scrubberContainer.setAttribute('aria-disabled', locked ? 'true' : 'false');
      speedContainer.hidden = playback.live;
      if (locked) {
        tooltip.classList.remove('visible');
        mediaFeatures.setHeatmapHover(null);
      }
      return { live: playback.live, behindLive, canJumpToLive };
    };

    let clockPaintKey = '';
    const paintClocks = (cur: number, end: number, animate: boolean) => {
      const labels = clockLabels(cur, end, showTotalTime);
      const action = showTotalTime ? t('showRemainingTime') : t('showTotalTime');
      const key = `${labels.elapsed}\0${labels.edge}\0${action}`;
      if (key === clockPaintKey) return;
      clockPaintKey = key;
      elapsedReadout.classList.remove('is-absent', 'theater-time-live', 'theater-time-live-behind', 'theater-time-live-jump');
      elapsedReadout.dir = 'ltr';
      elapsedReadout.title = '';
      elapsedReadout.removeAttribute('aria-label');
      endReadout.classList.remove('is-absent', 'theater-time-live', 'theater-time-live-behind', 'theater-time-live-jump');
      renderTimeReadout(elapsedReadout, labels.elapsed, animate);
      renderTimeReadout(endReadout, labels.edge, animate);
      endReadout.title = action;
      endReadout.setAttribute('aria-label', action);
    };

    const paintLive = (behindLive: boolean, canJumpToLive: boolean) => {
      const key = `live:${behindLive}:${canJumpToLive}:${t('liveBadge')}`;
      if (key === clockPaintKey) return;
      clockPaintKey = key;
      endReadout.classList.add('is-absent');
      endReadout.classList.remove('theater-time-live', 'theater-time-live-behind', 'theater-time-live-jump');
      elapsedReadout.classList.remove('is-absent');
      elapsedReadout.removeAttribute('dir');
      elapsedReadout.classList.add('theater-time-live');
      elapsedReadout.classList.toggle('theater-time-live-behind', behindLive);
      elapsedReadout.classList.toggle('theater-time-live-jump', behindLive);
      elapsedReadout.style.cursor = canJumpToLive ? 'pointer' : '';
      renderLiveBadge(elapsedReadout, t('liveBadge'));
      elapsedReadout.title = behindLive ? t('jumpToLive') : '';
      elapsedReadout.setAttribute('aria-label', behindLive ? t('jumpToLive') : t('liveBadge'));
    };

    const paintTimeDisplay = (
      playback: ChromePlayback,
      chrome: ReturnType<typeof syncLiveChrome>,
      animate: boolean
    ) => {
      const cur = displayMediaTime(video);
      if (playback.live) {
        paintLive(chrome.behindLive, chrome.canJumpToLive);
        return;
      }
      paintClocks(cur, playback.end, animate);
    };

    leftSec.appendChild(playPauseBtn);
    leftSec.appendChild(previousBtn);
    leftSec.appendChild(nextBtn);
    leftSec.appendChild(volumeContainer);
    leftSec.appendChild(elapsedReadout);

    // Right Controls Section
    const rightSec = document.createElement('div');
    rightSec.className = 'theater-controls-right';
    const dismissOtherMenus = { run: () => {} };
    const settings = createPlayerSettings(ctx, controlsScope, {
      onBeforeOpen: () => dismissOtherMenus.run()
    });

    // Playback Speed Controls
    const speedContainer = document.createElement('div');
    speedContainer.className = 'theater-speed-container theater-popover';
    speedContainer.addEventListener('pointerenter', updateCaptionDock);
    speedContainer.addEventListener('pointerleave', (event) => {
      armPictureDismissOnLeave(event, speedContainer);
      updateCaptionDock();
    });

    const speedBtn = document.createElement('button');
    speedBtn.className = 'theater-control-btn speed-btn';

    const speedLabel = document.createElement('span');
    speedLabel.className = 'speed-label';
    speedBtn.appendChild(speedLabel);

    const speedLevels = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
    const getSpeedIndex = (rate: number): number => {
      let closestIdx = 3; // default to 1.0
      let minDiff = Infinity;
      for (let i = 0; i < speedLevels.length; i++) {
        const diff = Math.abs(speedLevels[i] - rate);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      }
      return closestIdx;
    };

    const updateSpeedLabelText = () => {
      speedLabel.textContent = video.playbackRate.toFixed(2).replace(/\.00$|\.0$/, '') + 'x';
    };
    updateSpeedLabelText();

    const speedPanel = document.createElement('div');
    speedPanel.className = 'theater-speed-panel';

    const speedTooltip = document.createElement('div');
    speedTooltip.className = 'theater-speed-tooltip-vertical';

    const speedSliderWrapper = document.createElement('div');
    speedSliderWrapper.className = 'theater-vertical-slider-wrapper';

    const speedSlider = document.createElement('input');
    speedSlider.type = 'range';
    speedSlider.className = 'theater-speed-slider theater-vertical-slider';
    speedSlider.min = '0';
    speedSlider.max = String(speedLevels.length - 1);
    speedSlider.step = '1';
    speedSlider.value = String(getSpeedIndex(video.playbackRate));

    const speedTick1x = document.createElement('div');
    speedTick1x.className = 'speed-tick-1x-vertical';

    speedSliderWrapper.appendChild(speedSlider);
    speedSliderWrapper.appendChild(speedTick1x);
    speedPanel.appendChild(speedTooltip);
    speedPanel.appendChild(speedSliderWrapper);

    speedContainer.appendChild(speedBtn);
    speedContainer.appendChild(speedPanel);

    let lastNonNormalSpeed = 1.5;

    const updateSpeedSliderFill = () => {
      const idx = getSpeedIndex(video.playbackRate);
      const pct = (idx / (speedLevels.length - 1)) * 100;
      const accentColor = 'var(--accent-color, #6366f1)';
      const grad = `linear-gradient(to right, ${accentColor} 0%, ${accentColor} ${pct}%, rgba(255, 255, 255, 0.2) ${pct}%, rgba(255, 255, 255, 0.2) 100%)`;
      speedSlider.style.setProperty('background', grad, 'important');
    };
    updateSpeedSliderFill();

    const updateSpeedTooltip = () => {
      speedTooltip.textContent = `${video.playbackRate.toFixed(2).replace(/\.00$|\.0$/, '')}x`;
    };
    updateSpeedTooltip();

    speedBtn.addEventListener('click', (event) => {
      if (video.playbackRate !== 1.0) {
        lastNonNormalSpeed = video.playbackRate;
        video.playbackRate = 1.0;
      } else {
        video.playbackRate = lastNonNormalSpeed;
      }
      blurMouseToggle(event, speedBtn);
    });

    speedSlider.addEventListener('input', (e) => {
      const idx = parseInt((e.target as HTMLInputElement).value, 10);
      const rate = speedLevels[idx];
      video.playbackRate = rate;
      if (rate !== 1.0) {
        lastNonNormalSpeed = rate;
      }
      updateSpeedSliderFill();
      updateSpeedTooltip();
    });

    // PiP Button
    const pipBtn = document.createElement('button');
    pipBtn.className = 'theater-control-btn pip-btn';
    if (!video.capabilities.pictureInPicture || !document.pictureInPictureEnabled) {
      pipBtn.style.display = 'none';
    }

    bindCustomTooltip(pipBtn, () => t('pictureInPictureTooltip', ui().shortcuts.togglePiP));

    setIcon(pipBtn, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect><rect x="13" y="11" width="7" height="7" rx="1" ry="1"></rect></svg>`);
    const syncPipButton = () => {
      pipBtn.classList.toggle('active', native != null && document.pictureInPictureElement === native);
    };
    syncPipButton();
    video.addEventListener('enterpictureinpicture', syncPipButton);
    video.addEventListener('leavepictureinpicture', syncPipButton);
    pipBtn.addEventListener('click', () => togglePictureInPicture(video));

    // Fullscreen Button
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.className = 'theater-control-btn fullscreen-btn';
  
    bindCustomTooltip(fullscreenBtn, () => {
      return document.fullscreenElement ? t('exitFullscreen') : t('fullscreenTooltip', ui().shortcuts.toggleFullscreen);
    });

    const enterFullscreenIcon = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
      </svg>
    `;
    const exitFullscreenIcon = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 14h6v6m10-6h-6v6M4 10h6V4m10 6h-6V4"></path>
      </svg>
    `;

    const syncFullscreenButton = () => {
      const active = Boolean(document.fullscreenElement);
      fullscreenBtn.classList.toggle('active', active);
      fullscreenBtn.setAttribute('aria-pressed', String(active));
      setIcon(fullscreenBtn, active ? exitFullscreenIcon : enterFullscreenIcon);
    };
    syncFullscreenButton();

    const controlsEpoch = session.currentEpoch;
    const fullscreenRecovery = createFullscreenRecovery(controlsScope, video,
      () => session.currentEpoch === controlsEpoch && session.element === video.element
        && !session.isIdle && !session.isExiting,
      () => refs.playbackDecisionRevision);

    const toggleFullscreen = () => {
      const operation = fullscreenRecovery.begin();
      if (!operation.isCurrent()) return;
      ctx.actions.suppressToolbarActivity();
      const resume = () => operation.schedule();
      const fail = (error: unknown) => {
        operation.cancel();
        console.error(error);
      };
      try {
        if (document.fullscreenElement) {
          void document.exitFullscreen().then(resume, fail);
        } else {
          const target = session.element
            ? document.documentElement
            : (native?.parentElement || native || document.documentElement);
          void target.requestFullscreen().then(resume, () => {
            if (!operation.isCurrent()) return;
            if (nativeChatState()?.visible) {
              operation.cancel();
              ctx.actions.triggerStatusIndicator(t('nativeChatFullscreenUnavailable'), '');
              return;
            }
            if (!native || typeof native.requestFullscreen !== 'function') {
              operation.cancel();
              return;
            }
            try { void native.requestFullscreen().then(resume, fail); } catch (error) { fail(error); }
          });
        }
      } catch (error) { fail(error); }
    };
    refs.currentToggleFullscreen = toggleFullscreen;

    fullscreenBtn.addEventListener('click', () => {
      toggleFullscreen();
    });

    const onFullscreenChange = () => {
      syncFullscreenButton();
      ctx.actions.suppressToolbarActivity();
      fullscreenRecovery.onFullscreenChange();
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);

    // Close Button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'theater-control-btn close-btn';
  
    bindCustomTooltip(closeBtn, () => {
      const toggleKey = escapeHtml((ui().shortcuts.toggle || t('shortcutUnassigned')).toUpperCase());
      const exitKey = escapeHtml(ui().shortcuts.exit === 'Escape' ? 'Esc' : (ui().shortcuts.exit || 'Esc'));
      return t('exitTheaterModeTooltip', [toggleKey, exitKey]);
    });

    setIcon(closeBtn, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="20" y1="4" x2="4" y2="20"></line><line x1="4" y1="4" x2="20" y2="20"></line></svg>`);
    closeBtn.addEventListener('click', () => {
      exitTheaterMode();
    });

    // Subtitles / CC Button
    const ccBtn = document.createElement('button');
    ccBtn.className = 'theater-control-btn cc-btn';

    const ccMenu = document.createElement('div');
    ccMenu.id = 'theater-cc-menu';
    ccMenu.className = 'theater-cc-menu';
    ccBtn.setAttribute('aria-haspopup', 'menu');
    ccBtn.setAttribute('aria-expanded', 'false');
    ccBtn.setAttribute('aria-controls', 'theater-cc-menu');
    paintOverlay(ccMenu);
    const ccHost = document.createElement('div');
    ccHost.className = 'theater-cc-menu-host theater-menu-anchored';
    ccHost.append(ccBtn, ccMenu);

    const mediaFeatures = new MediaFeaturesController({
      video,
      ccBtn,
      ccMenu,
      scrubberTrack,
      t,
      onCaptionChange: () => updateCaptionDock(true),
      onSubtitleLayoutChange: (on) => ctx.actions.applySubtitleLayout(on),
      onCaptionHud: showCaptionHud,
      onCaptionStyleChange: persistCaptionStyle,
      captionPreference: refs.captionPreferenceMap[captionPreferenceHost(window.location.hostname)] || null,
      onCaptionPreferenceChange: persistCaptionPreference,
      providerFlags: refs.providerFlags,
      decorateCaptionDialog: (overlay) => {
        paintOverlay(overlay);
      },
      onSnapshot: (snapshot) => {
        session.publishSnapshot(snapshot, session.currentEpoch);
      },
      onTitle: syncContentTitle
    });
    wrapper._mediaFeatures = mediaFeatures;
    mediaFeatures.setCaptionStyle(ui().captionStyle);
    updateCaptionDock();

    bindCustomTooltip(ccBtn, () => {
      if (mediaFeatures.ccTooltip() === t('noSubtitlesAvailable')) return t('noSubtitlesAvailable');
      return t('subtitlesTooltip', ui().shortcuts.toggleCaptions);
    });

    setIcon(ccBtn, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M10 9H8a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2"></path><path d="M10 9H8a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2" transform="translate(8 0)"></path></svg>`);

    const handleTrackChange = () => {
      void mediaFeatures.refresh();
    };

    if (native?.textTracks) {
      native.textTracks.addEventListener('change', handleTrackChange);
      native.textTracks.addEventListener('addtrack', handleTrackChange);
      native.textTracks.addEventListener('removetrack', handleTrackChange);
    }
    const onTrackElementLoad = () => { void mediaFeatures.refresh(); };
    native?.querySelectorAll('track').forEach((trackEl) => {
      trackEl.addEventListener('load', onTrackElementLoad);
    });

    const ccPopover = bindMenuPopover({
      host: ccHost,
      trigger: ccBtn,
      panel: ccMenu,
      scope: controlsScope,
      onBeforeOpen: () => {
        settings.close();
        volumeBtn.blur();
        volumeSlider.blur();
        speedBtn.blur();
        speedSlider.blur();
      },
      prepare: () => mediaFeatures.renderCcMenu(),
      onChange: updateCaptionDock
    });
    const blurSliders = () => {
      volumeBtn.blur();
      volumeSlider.blur();
      speedBtn.blur();
      speedSlider.blur();
    };
    dismissOtherMenus.run = () => {
      ccPopover.close();
      blurSliders();
    };

    const dismissPopoversIfOutside = (e: Event) => {
      const primary = !('button' in e) || (e as MouseEvent).button === 0;
      const onPicture = eventPathIncludes(e, session.element) || eventPathMatches(e, '.theater-wasm-catcher');
      if (primary && (e.type === 'pointerdown' || e.type === 'mousedown')) {
        if (onPicture) {
          if (playerChromeExpanded(wrapper)) armPictureDismiss();
        } else {
          clearPictureDismiss();
        }
      }
      const inCc = eventPathIncludes(e, ccHost);
      const inVolume = eventPathMatches(e, '.theater-volume-container');
      const inSpeed = eventPathMatches(e, '.theater-speed-container');
      const inSettings = eventPathIncludes(e, settings.container);
      if (!inSettings) settings.close();
      if (!inCc) ccPopover.close();
      if (!inVolume) {
        volumeBtn.blur();
        volumeSlider.blur();
      }
      if (!inSpeed) {
        speedBtn.blur();
        speedSlider.blur();
      }
      updateCaptionDock();
    };
    const clearDismissOnKey = () => clearPictureDismiss();
    window.addEventListener('pointerdown', dismissPopoversIfOutside, true);
    window.addEventListener('click', dismissPopoversIfOutside, true);
    window.addEventListener('keydown', clearDismissOnKey, true);

    const onWindowBlur = () => {
      closeTheaterPopovers();
      updateCaptionDock();
    };
    window.addEventListener('blur', onWindowBlur);

    rightSec.appendChild(endReadout);
    rightSec.appendChild(ccHost);
    rightSec.appendChild(speedContainer);

    const fitBtn = document.createElement('button');
    fitBtn.className = 'theater-control-btn video-fit-btn';
    fitBtn.hidden = !video.capabilities.objectFit;
    const updateFitButtonIcon = () => {
      setIcon(fitBtn, `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3"></path>
          <path d="M16 3h3a2 2 0 0 1 2 2v3"></path>
          <path d="M8 21H5a2 2 0 0 1-2-2v-3"></path>
          <path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>
          <rect x="8" y="8" width="8" height="8" rx="1"></rect>
        </svg>
      `);
    };
    updateFitButtonIcon();
    fitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      executeCommand({ type: 'CYCLE_FIT' });
    });
    const fitRow = video.capabilities.objectFit ? settings.addRow(fitBtn, t('videoFitLabel')) : null;
    const updateFitRow = () => fitRow?.update(ui().shortcuts.cycleFit, t(
      ui().videoFit === 'cover' ? 'videoFitCover' : ui().videoFit === 'fill' ? 'videoFitFill' : 'videoFitContain'
    ));
    updateFitRow();
    controlsScope.add(ctx.uiStore.subscribe(updateFitRow));

    const layoutBtn = document.createElement('button');
    layoutBtn.className = 'theater-control-btn picture-layout-btn';
    setIcon(layoutBtn, PICTURE_LAYOUT_ICON);
    layoutBtn.addEventListener('click', event => {
      event.stopPropagation();
      executeCommand({ type: 'CYCLE_LAYOUT' });
    });
    const layoutRow = settings.addRow(layoutBtn, t('pictureAlignLabel'));
    const updateLayoutRow = () => layoutRow.update(ui().shortcuts.cycleLayout,
      t(ui().pictureAlign === 'top' ? 'pictureAlignTop' : 'pictureAlignCenter'));
    updateLayoutRow();
    controlsScope.add(ctx.uiStore.subscribe(updateLayoutRow));

    if (native && video.capabilities.nativeMedia) {
      const audioRow = (className: string, icon: string, label: string, command: PlayerCommand) => {
        const button = document.createElement('button');
        button.className = `theater-control-btn ${className}`;
        setIcon(button, icon);
        button.addEventListener('click', event => {
          event.stopPropagation();
          executeCommand(command);
        });
        return { button, row: settings.addRow(button, t(label), 'audio') };
      };
      const boost = video.capabilities.volumeBoost
        ? audioRow('volume-boost-btn', VOLUME_BOOST_ICONS.menu, 'volumeBoostLabel', { type: 'TOGGLE_VOLUME_BOOST' })
        : null;
      const audioRows = AUDIO_SETTING_NAMES.map((name) => ({
        name,
        ...audioRow(`audio-${name}-btn`, AUDIO_SETTING_ICONS[name].menu, AUDIO_LABEL_KEYS[name], { type: 'CYCLE_AUDIO', setting: name })
      }));
      const updateAudioRows = () => {
        const block = ctx.actions.audioBlock(native);
        const shortcuts = ui().shortcuts;
        settings.setAudioNote(block && t(AUDIO_BLOCK_KEYS[block]));
        if (block) return;
        if (boost) boost.row.update(shortcuts.toggleVolumeBoost, t(ui().volumeBoost ? 'volumeBoostOn' : 'volumeBoostOff'));
        for (const { name, row } of audioRows) {
          row.update(shortcuts[AUDIO_SHORTCUTS[name]], t(audioLevelLabelKey(ui().audio, name)));
        }
      };
      updateAudioRows();
      controlsScope.add(ctx.uiStore.subscribe(updateAudioRows));
      // DRM and a refused CORS reload only become visible once the media loads.
      controlsScope.listen(native, 'encrypted', updateAudioRows);
      controlsScope.listen(native, 'loadedmetadata', updateAudioRows);
    }
    ctx.actions.syncAudioSettings();

    // Switch Video Button (Only if there are multiple real video players on the page)
    const videosOnPage = native ? selectSwitchableVideos(findAllVideosDeep(document), native) : [];
    if (videosOnPage.length > 1) {
      const switchVideoBtn = document.createElement('button');
      switchVideoBtn.className = 'theater-control-btn switch-video-btn';
      setIcon(switchVideoBtn, `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"></path>
        </svg>
      `);
      switchVideoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settings.close();
        executeCommand({ type: 'CYCLE_VIDEO', direction: 'next' });
      });
      const switchRow = settings.addRow(switchVideoBtn, t('cycleSwitchVideo'));
      const updateSwitchRow = () => switchRow.update(ui().shortcuts.cycle);
      updateSwitchRow();
      controlsScope.add(ctx.uiStore.subscribe(updateSwitchRow));
    }

    rightSec.appendChild(pipBtn);
    rightSec.appendChild(fullscreenBtn);

    mountNativeChatControls(ctx, controlsScope, rightSec, settings.panel, bindCustomTooltip);

    rightSec.append(settings.container);

    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'theater-control-btn controls-visibility-toggle';
    setIcon(pinBtn, CONTROLS_VISIBILITY_ICON);
    const pinRow = settings.addRow(pinBtn, t('keepControlsVisibleTitle'));
    const updatePinButton = () => {
      const pinned = ui().keepControlsVisible;
      pinBtn.classList.toggle('active', pinned);
      pinBtn.setAttribute('aria-pressed', String(pinned));
      pinBtn.setAttribute('aria-label', t('keepControlsVisibleTitle'));
      pinBtn.setAttribute('aria-keyshortcuts', ui().shortcuts.toggleControlsPin);
      pinRow.update(ui().shortcuts.toggleControlsPin, t(pinned ? 'controlsVisibilityOn' : 'controlsVisibilityOff'));
    };
    pinBtn.addEventListener('click', (event) => {
      blurMouseToggle(event, pinBtn);
      executeCommand({ type: 'TOGGLE_CONTROLS_PIN' });
    });
    updatePinButton();
    controlsScope.add(ctx.uiStore.subscribe(updatePinButton));

    // Help Button (Keyboard shortcuts listing)
    const helpBtn = document.createElement('button');
    helpBtn.className = 'theater-control-btn help-btn';
    setIcon(helpBtn, `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
    `);
    helpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showHelpOverlay();
    });
    const helpRow = settings.addRow(helpBtn, t('keyboardShortcutsTitle'), 'shortcuts');
    const updateHelpRow = () => helpRow.update(ui().shortcuts.showHelp);
    updateHelpRow();
    controlsScope.add(ctx.uiStore.subscribe(updateHelpRow));

    const autoTheaterBtn = document.createElement('button');
    autoTheaterBtn.className = 'theater-control-btn auto-theater-btn';
    autoTheaterBtn.title = t('autoEnterTheaterDescription');
    setIcon(autoTheaterBtn, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/><path d="m10 8 6 4-6 4z"/></svg>`);
    autoTheaterBtn.addEventListener('click', event => {
      event.stopPropagation();
      executeCommand({ type: 'TOGGLE_AUTO_THEATER' });
    });
    const autoTheaterRow = settings.addRow(autoTheaterBtn, t('autoEnterTheaterTitle'));
    const updateAutoTheaterRow = () => {
      autoTheaterBtn.classList.toggle('active', ui().autoEnterTheater);
      autoTheaterBtn.setAttribute('aria-pressed', String(ui().autoEnterTheater));
      autoTheaterRow.update('', t(ui().autoEnterTheater ? 'autoEnterTheaterOn' : 'autoEnterTheaterOff'));
    };
    updateAutoTheaterRow();
    controlsScope.add(ctx.uiStore.subscribe(updateAutoTheaterRow));

    const extensionSettingsBtn = document.createElement('button');
    extensionSettingsBtn.type = 'button';
    extensionSettingsBtn.className = 'theater-control-btn extension-settings-btn';
    setIcon(extensionSettingsBtn, `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 21v-7"></path>
        <path d="M4 10V3"></path>
        <path d="M12 21v-9"></path>
        <path d="M12 8V3"></path>
        <path d="M20 21v-5"></path>
        <path d="M20 12V3"></path>
        <path d="M2 14h4"></path>
        <path d="M10 8h4"></path>
        <path d="M18 16h4"></path>
      </svg>
    `);
    extensionSettingsBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      settings.close();
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ action: 'open-options-page' }, () => {
            void chrome.runtime.lastError;
          });
        }
      } catch {
        // The player can render where the extension runtime is unavailable.
      }
    });
    settings.addRow(extensionSettingsBtn, t('extensionSettingsLabel'), 'footer');

    rightSec.appendChild(closeBtn);

    controlsRow.appendChild(leftSec);
    controlsRow.appendChild(scrubberContainer);
    controlsRow.appendChild(rightSec);
    controlsRow.appendChild(tooltip);

    wrapper.appendChild(controlsRow);

    mountPlayerUi(wrapper);
    ctx.actions.createPlayerHeader();
    void mediaFeatures.start();

    // Scrubber updates
    let isDragging = false;
    let lastSeekTime = 0;
    let seekTimeout: number | null = null;
    controlsScope.add(() => {
      if (seekTimeout) clearTimeout(seekTimeout);
      seekTimeout = null;
    });

    const throttledSeek = (time: number) => {
      const now = Date.now();
      if (now - lastSeekTime >= 100) {
        seekHostTime(video, time);
        lastSeekTime = now;
        if (seekTimeout) {
          clearTimeout(seekTimeout);
          seekTimeout = null;
        }
      } else {
        if (seekTimeout) clearTimeout(seekTimeout);
        seekTimeout = window.setTimeout(() => {
          seekTimeout = null;
          seekHostTime(video, time);
          lastSeekTime = Date.now();
        }, 100 - (now - lastSeekTime));
      }
    };

    const paintScrubber = (window: ChromePlayback) => {
      const cur = video.currentTime || 0;

      if (window.seekable && video.buffered && video.buffered.length > 0) {
        let bufferedEnd = cur;
        for (let i = 0; i < video.buffered.length; i++) {
          const start = video.buffered.start(i);
          const end = video.buffered.end(i);
          if (cur >= start && cur <= end) {
            bufferedEnd = end;
            break;
          }
        }
        scrubberBuffer.style.width = `${timeToRatio(bufferedEnd, window) * 100}%`;
      } else {
        scrubberBuffer.style.width = window.live && !window.seekable ? '100%' : '0%';
      }

      if (isDragging) return;
      const pct = timeToRatio(displayMediaTime(video), window) * 100;
      scrubberFill.style.width = `${pct}%`;
    };

    // One playback snapshot feeds the live chrome, scrubber and clock, so a
    // single update reads the host window once. A hidden bar skips these
    // cosmetic writes; `_syncPlaybackChrome` catches it up as it is shown.
    // Captions and seeks read live state themselves and never wait on it.
    const paintPlaybackChrome = (animate: boolean) => {
      const playback = playbackForChrome();
      if (!playback) return;
      const chrome = syncLiveChrome(playback);
      paintScrubber(playback);
      paintTimeDisplay(playback, chrome, animate);
    };
    const updatePlaybackChrome = (animate = true) => {
      if (wrapper.classList.contains('visible')) paintPlaybackChrome(animate);
    };
    wrapper._syncPlaybackChrome = () => paintPlaybackChrome(false);
    paintPlaybackChrome(false);

    const updateTooltip = (clientX: number) => {
      const window = playbackForChrome() ?? playbackWindow(video);
      if (!window.seekable) return;
      const rect = scrubberContainer.getBoundingClientRect();
      if (rect.width === 0) return;
      // Read both anchors before handle, heatmap or tooltip mutations can dirty layout.
      const rowRect = controlsRow.getBoundingClientRect();
    
      const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const time = ratioToTime(pos, window);
      const extras = mediaFeatures.tooltipExtras(time);
      scrubberHandle.style.left = `${pos * 100}%`;
      mediaFeatures.setHeatmapHover(pos);

      const previewHidden = !extras.preview;
      if (preview.hidden !== previewHidden) preview.hidden = previewHidden;
      if (extras.preview) {
        const image = extras.preview.image;
        const scale = PREVIEW_DISPLAY_WIDTH / image.tileWidth;
        setPreviewStyle('height', `${Math.round(image.tileHeight * scale)}px`);
        setPreviewStyle('backgroundImage', `url(${JSON.stringify(image.url)})`);
        setPreviewStyle('backgroundPosition', `-${Math.round(image.x * scale)}px -${Math.round(image.y * scale)}px`);
        setPreviewStyle('backgroundSize', `${Math.round(image.sheetWidth * scale)}px ${Math.round(image.sheetHeight * scale)}px`);
      }
      const chapterHidden = !extras.chapterTitle;
      if (chapterTitle.hidden !== chapterHidden) chapterTitle.hidden = chapterHidden;
      const chapterText = extras.chapterTitle ?? '';
      if (chapterTitle.textContent !== chapterText) chapterTitle.textContent = chapterText;
      const timeText = window.live
        ? (isAtLiveEdge(time, window) || (window.end - time) > MAX_LIVE_DVR_SECONDS ? t('liveBadge') : `-${formatTime(Math.max(0, window.end - time))}`)
        : formatTime(time);
      if (timeLabel.textContent !== timeText) timeLabel.textContent = timeText;

      const left = `${(rect.left - rowRect.left) + pos * rect.width}px`;
      if (tooltipLeft !== left) {
        tooltipLeft = left;
        tooltip.style.left = left;
      }
      if (!tooltip.classList.contains('visible')) tooltip.classList.add('visible');
      updateCaptionDock();
    };

    let tooltipFrame = 0;
    const cancelTooltipFrame = () => {
      if (tooltipFrame) window.cancelAnimationFrame(tooltipFrame);
      tooltipFrame = 0;
    };
    controlsScope.add(cancelTooltipFrame);
    let pendingTooltipX = 0;
    const onScrubberMouseMove = (e: MouseEvent) => {
      if (isDragging || !playbackWindow(video).seekable) return;
      pendingTooltipX = e.clientX;
      if (tooltipFrame) return;
      tooltipFrame = window.requestAnimationFrame(() => {
        tooltipFrame = 0;
        updateTooltip(pendingTooltipX);
      });
    };

    const onScrubberMouseLeave = () => {
      cancelTooltipFrame();
      if (!isDragging) {
        tooltip.classList.remove('visible');
        mediaFeatures.setHeatmapHover(null);
        updateCaptionDock();
      }
    };

    scrubberContainer.addEventListener('mousemove', onScrubberMouseMove);
    scrubberContainer.addEventListener('mouseleave', onScrubberMouseLeave);

    const handleSeekEvent = (clientX: number, seekMode: 'none' | 'immediate' | 'throttled' = 'none') => {
      const window = playbackWindow(video);
      if (!window.seekable) return 0;
      const rect = scrubberContainer.getBoundingClientRect();
      if (rect.width === 0) return 0;
    
      const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const pct = pos * 100;
      scrubberFill.style.width = `${pct}%`;
      scrubberHandle.style.left = `${pct}%`;
      mediaFeatures.setHeatmapHover(pos);
    
      const targetTime = ratioToTime(pos, window);
      if (window.live) {
        paintLive(window.seekable && !isAtLiveEdge(targetTime, window), window.seekable);
      } else {
        paintClocks(targetTime, window.end, false);
      }
    
      if (isDragging) {
        updateTooltip(clientX);
      }
    
      if (seekMode === 'immediate') {
        if (seekTimeout) {
          clearTimeout(seekTimeout);
          seekTimeout = null;
        }
        seekHostTime(video, targetTime);
        lastSeekTime = Date.now();
      } else if (seekMode === 'throttled') {
        throttledSeek(targetTime);
      }
    
      return targetTime;
    };

    const onScrubberMouseDown = (e: MouseEvent) => {
      if (!playbackWindow(video).seekable) return;
      e.preventDefault();
      seekCompletionScope?.dispose();
      seekCompletionScope = null;
      isDragging = true;
      scrubberContainer.classList.add('dragging');
      handleSeekEvent(e.clientX, 'immediate');
    
      const onMouseMove = (moveEvt: MouseEvent) => {
        handleSeekEvent(moveEvt.clientX, 'throttled');
      };

      const onMouseUp = (upEvt: MouseEvent) => {
        seekCompletionScope?.dispose();
        seekCompletionScope = new DisposableScope();
        waitForSeekCompletion(seekCompletionScope, video, () => {
          seekCompletionScope = null;
          isDragging = false;
          scrubberContainer.classList.remove('dragging');
          const rect = scrubberContainer.getBoundingClientRect();
          if (upEvt.clientX < rect.left || upEvt.clientX > rect.right
            || upEvt.clientY < rect.top || upEvt.clientY > rect.bottom) {
            tooltip.classList.remove('visible');
            mediaFeatures.setHeatmapHover(null);
          }
        });

        handleSeekEvent(upEvt.clientX, 'immediate');
        gestureScope?.dispose();
        gestureScope = null;
      };

      gestureScope?.dispose();
      gestureScope = new DisposableScope();
      gestureScope.listen(document, 'mousemove', onMouseMove, true);
      gestureScope.listen(document, 'mouseup', onMouseUp, true);
    };

    scrubberContainer.addEventListener('mousedown', onScrubberMouseDown);

    const onScrubberTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      if (!playbackWindow(video).seekable) return;
      seekCompletionScope?.dispose();
      seekCompletionScope = null;
      isDragging = true;
      scrubberContainer.classList.add('dragging');
      handleSeekEvent(e.touches[0].clientX, 'immediate');

      const onTouchMove = (moveEvt: TouchEvent) => {
        if (moveEvt.touches.length === 1) {
          handleSeekEvent(moveEvt.touches[0].clientX, 'throttled');
        }
      };

      const onTouchEnd = (endEvt: TouchEvent) => {
        seekCompletionScope?.dispose();
        seekCompletionScope = new DisposableScope();
        waitForSeekCompletion(seekCompletionScope, video, () => {
          seekCompletionScope = null;
          isDragging = false;
          scrubberContainer.classList.remove('dragging');
          tooltip.classList.remove('visible');
          mediaFeatures.setHeatmapHover(null);
        });

        if (endEvt.changedTouches.length === 1) {
          handleSeekEvent(endEvt.changedTouches[0].clientX, 'immediate');
        }
        gestureScope?.dispose();
        gestureScope = null;
      };

      gestureScope?.dispose();
      gestureScope = new DisposableScope();
      gestureScope.listen(document, 'touchmove', onTouchMove, { capture: true, passive: true });
      gestureScope.listen(document, 'touchend', onTouchEnd, true);
      gestureScope.listen(document, 'touchcancel', onTouchEnd, true);
    };
    scrubberContainer.addEventListener('touchstart', onScrubberTouchStart, { passive: true });

    // Buffering / Loading State Helper
    let bufferingTimeout: number | null = null;

    const setBuffering = (isBuffering: boolean, immediate = false) => {
      if (isBuffering) {
        if (immediate) {
          if (bufferingTimeout) {
            clearTimeout(bufferingTimeout);
            bufferingTimeout = null;
          }
          loadingIndicator.classList.add('visible');
          scrubberContainer.classList.add('buffering');
          return;
        }
        if (bufferingTimeout || loadingIndicator.classList.contains('visible')) return;
        bufferingTimeout = window.setTimeout(() => {
          loadingIndicator.classList.add('visible');
          scrubberContainer.classList.add('buffering');
          bufferingTimeout = null;
        }, 1000);
      } else {
        if (bufferingTimeout) {
          clearTimeout(bufferingTimeout);
          bufferingTimeout = null;
        }
        loadingIndicator.classList.remove('visible');
        scrubberContainer.classList.remove('buffering');
      }
    };

    let lastProviderPlayhead = Number.NaN;
    const onProviderClock = (published: number | null) => {
      const playhead = published ?? readProviderClock(native) ?? Number.NaN;
      updatePlaybackChrome();
      mediaFeatures.updateTime(published ?? displayMediaTime(video));
      if (Number.isFinite(playhead) && Number.isFinite(lastProviderPlayhead) && Math.abs(playhead - lastProviderPlayhead) > 0.04) {
        setBuffering(false);
      }
      if (Number.isFinite(playhead)) lastProviderPlayhead = playhead;
    };

    // Event hookups
    const onPlay = () => {
      setIcon(playPauseBtn, pauseIcon);
      setBuffering(false);
    };
    const onPause = () => { setIcon(playPauseBtn, playIcon); };
    let lastMediaHref = window.location.href;
    const onTimeUpdate = () => { 
      updatePlaybackChrome();
      mediaFeatures.updateTime(displayMediaTime(video));
      if (!video.paused && !video.seeking && video.readyState >= 3) {
        setBuffering(false);
      }
      const playhead = readProviderClock(native) ?? Number.NaN;
      if (!video.paused && Number.isFinite(playhead) && Number.isFinite(lastProviderPlayhead) && Math.abs(playhead - lastProviderPlayhead) > 0.04) {
        setBuffering(false);
      }
      if (window.location.href !== lastMediaHref) {
        lastMediaHref = window.location.href;
        void mediaFeatures.refresh();
      }
    };
    const onProgress = () => { updatePlaybackChrome(); };
    const onDurationChange = () => {
      updatePlaybackChrome();
      if (Number.isFinite(video.duration)) void mediaFeatures.refresh();
    };
    const onMediaReset = () => {
      cancelTooltipFrame();
      fullscreenRecovery.invalidate();
      gestureScope?.dispose();
      gestureScope = null;
      seekCompletionScope?.dispose();
      seekCompletionScope = null;
      if (seekTimeout) clearTimeout(seekTimeout);
      seekTimeout = null;
      isDragging = false;
      scrubberContainer.classList.remove('dragging');
      clearPendingMediaSeek(video);
      if (!mediaFeatures.retainCaptionsOnElementReset()) {
        mediaFeatures.invalidate();
        if (refreshProviderAfterElementReset()) {
          void mediaFeatures.refresh();
        }
      }
      tooltip.classList.remove('visible');
      preview.hidden = true;
      chapterTitle.hidden = true;
      chapterTitle.textContent = '';
      timeLabel.textContent = '';
      mediaFeatures.setHeatmapHover(null);
      updatePlaybackChrome();
      updateCaptionDock();
      setBuffering(true, true);
    };
    const onPageMediaChange = () => {
      fullscreenRecovery.invalidate();
      void mediaFeatures.refresh();
    };
    const onVolumeChange = () => {
      if (video.muted) {
        volumeSlider.value = '0';
      } else {
        if (video.logicalVolume !== undefined && video.logicalVolume > 1.0 && video.volume === 1.0) {
          volumeSlider.value = String(video.logicalVolume);
          rememberAudibleVolume(video, video.logicalVolume);
        } else {
          video.logicalVolume = video.volume;
          volumeSlider.value = String(video.volume);
          rememberAudibleVolume(video, video.volume);
        }
      }
      updateVolumeIcon();
      updateVolumeSliderFill();
      updateVolumeTooltip();
    };
    refs.onVolumeAdjustedCallback = onVolumeChange;
    const onRateChange = () => {
      updateSpeedLabelText();
      speedSlider.value = String(getSpeedIndex(video.playbackRate));
      updateSpeedSliderFill();
      updateSpeedTooltip();
    };
  
    let bufferingFailsafe: number | null = null;
    const armBufferingFailsafe = () => {
      if (bufferingFailsafe) clearTimeout(bufferingFailsafe);
      bufferingFailsafe = window.setTimeout(() => {
        bufferingFailsafe = null;
        if (!video.paused || readProviderClock(native) !== null) {
          setBuffering(false);
        }
      }, 4000);
    };
    const onWaiting = () => { setBuffering(true); armBufferingFailsafe(); };
    const onSeeking = () => { setBuffering(true); armBufferingFailsafe(); };
    const onSeeked = () => { 
      if (bufferingFailsafe) {
        clearTimeout(bufferingFailsafe);
        bufferingFailsafe = null;
      }
      updatePlaybackChrome();
      setBuffering(false); 
    };
    const onCanPlay = () => { setBuffering(false); };
    const onPlaying = () => { setBuffering(false); };
    const onStalled = () => {
      if (!video.paused) {
        setBuffering(true);
      }
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('progress', onProgress);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('loadedmetadata', onDurationChange);
    video.addEventListener('emptied', onMediaReset);
    const stopObservingProviderMedia = observeProviderMediaChanges(onPageMediaChange);
    const stopObservingProviderClock = observeProviderClock(native, onProviderClock);
    video.addEventListener('volumechange', onVolumeChange);
    video.addEventListener('ratechange', onRateChange);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('stalled', onStalled);

    wrapper._videoListenersCleanup = () => {
      refs.onVolumeAdjustedCallback = null;
      gestureScope?.dispose();
      gestureScope = null;
      seekCompletionScope?.dispose();
      seekCompletionScope = null;
      controlsScope.dispose();
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('progress', onProgress);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('loadedmetadata', onDurationChange);
      video.removeEventListener('emptied', onMediaReset);
      stopObservingProviderMedia();
      stopObservingProviderClock();
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('ratechange', onRateChange);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('stalled', onStalled);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('theater-everywhere-boost-ready', onBoostReady);
      video.removeEventListener('enterpictureinpicture', syncPipButton);
      video.removeEventListener('leavepictureinpicture', syncPipButton);
      if (bufferingTimeout) {
        clearTimeout(bufferingTimeout);
        bufferingTimeout = null;
      }
      if (bufferingFailsafe) {
        clearTimeout(bufferingFailsafe);
        bufferingFailsafe = null;
      }
      if (native?.textTracks) {
        native.textTracks.removeEventListener('change', handleTrackChange);
        native.textTracks.removeEventListener('addtrack', handleTrackChange);
        native.textTracks.removeEventListener('removetrack', handleTrackChange);
      }
      native?.querySelectorAll('track').forEach((trackEl) => {
        trackEl.removeEventListener('load', onTrackElementLoad);
      });
      mediaFeatures.dispose();
      wrapper._mediaFeatures = undefined;
      wrapper._syncPlaybackChrome = undefined;
      window.removeEventListener('pointerdown', dismissPopoversIfOutside, true);
      window.removeEventListener('click', dismissPopoversIfOutside, true);
      window.removeEventListener('keydown', clearDismissOnKey, true);
      clearPictureDismiss();
      window.removeEventListener('blur', onWindowBlur);
      loadingIndicator.remove();
    };

    // Reveal controls for mouse, touch, pen, and keyboard users.
    document.addEventListener('pointermove', showToolbar, { passive: true });
    document.addEventListener('pointerdown', showToolbar, { passive: true });
    // All player chrome, including the home pill, uses the same focus handler.
    controlsScope.listen(wrapper.getRootNode(), 'focusin', showToolbar);
    const serviceActions = createServiceActions({
      element: video.element,
      video,
      chapters: () => mediaFeatures.chapterContext(),
      label: t,
      seek: time => seekHostTime(video, time)
    });
    if (serviceActions) {
      mountServiceActionCta(controlsScope, {
        source: serviceActions,
        mount: mountPlayerUi,
        paint: paintOverlay,
        toolbarVisible: () => {
          const bar = queryPlayerUi<HTMLElement>('.theater-controls-wrapper');
          // Keep clear of the bar until its fade has actually finished.
          return ui().toolbarVisible || Boolean(bar && (bar.classList.contains('visible')
            || Number.parseFloat(getComputedStyle(bar).opacity) > 0.01));
        },
        subscribeToolbar: (listener) => ctx.uiStore.subscribe(listener),
        subscribeVisibility: listener => observeChromeVisibility(wrapper.getRootNode() as Document | ShadowRoot, listener),
        menuOpen: () => queryPlayerUi(`.theater-menu.is-open, .theater-cc-menu.visible, .theater-settings-menu.visible,
          .theater-volume-container:hover .theater-volume-panel, .theater-speed-container:hover .theater-speed-panel,
          .theater-volume-container:focus-within .theater-volume-panel, .theater-speed-container:focus-within .theater-speed-panel`) !== null,
        controlsLift: () => {
          const bar = queryPlayerUi<HTMLElement>('.theater-controls-wrapper');
          return bar && bar.offsetHeight > 0 ? bar.offsetHeight + 12 : 96;
        },
        onLayout: updateCaptionDock
      });
    }
    showToolbar();
  }

  // Cleans up custom controls
  function destroyCustomControls(): void {
    onDestroy?.();
    ctx.actions.hideHelpOverlay(false);
    const wrapper = queryPlayerUi('.theater-controls-wrapper') as ExtendedHTMLDivElement | null;
    if (wrapper?._videoListenersCleanup) {
      wrapper._videoListenersCleanup();
    }

    document.removeEventListener('pointermove', showToolbar);
    document.removeEventListener('pointerdown', showToolbar);
    if (refs.toolbarTimer) {
      clearTimeout(refs.toolbarTimer);
      refs.toolbarTimer = null;
    }
    refs.toolbarKeyboardInteractionActive = false;
    refs.toolbarActivityBlockedUntil = 0;
    document.documentElement.classList.remove(CURSOR_HIDDEN_CLASS);
    destroyPlayerUi();
    refs.currentToggleFullscreen = null;
  }

  return { bindCustomTooltip, createCustomControls, destroyCustomControls };
}
