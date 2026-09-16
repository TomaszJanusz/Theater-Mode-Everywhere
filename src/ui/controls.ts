import { DISNEY_CLOCK_EVENT } from '../media-features/parsers/disney-page';
import { captionPreferenceHost } from '../media-features/caption-preference';
import { MediaFeaturesController } from '../media-features/controller';
import { PREVIEW_DISPLAY_WIDTH } from '../media-features/preview-display';
import { DisposableScope } from '../core/disposable-scope';
import type { PlayerCommand } from '../core/player-session';
import {
  isAtLiveEdge,
  isVideoAtLiveEdge,
  MAX_LIVE_DVR_SECONDS,
  playbackWindow,
  ratioToTime,
  seekToLive,
  timeToRatio,
  displayMediaTime,
  clearPendingMediaSeek
} from '../playback-window';
import { selectSwitchableVideos } from '../switchable-videos';
import { CURSOR_HIDDEN_CLASS } from './toolbar';
import type { BoostedVideoElement, PlayerChromeContext } from './runtime-context';

export interface ExtendedHTMLDivElement extends HTMLDivElement {
  _videoListenersCleanup?: () => void;
  _mediaFeatures?: MediaFeaturesController;
}

interface TooltipState {
  element: HTMLDivElement | null;
}

export function createControls(ctx: PlayerChromeContext) {
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
  const updateCaptionDock = () => ctx.actions.updateCaptionDock();
  const closeTheaterPopovers = () => ctx.actions.closeTheaterPopovers();
  const blurMouseToggle = (event: MouseEvent, button: HTMLElement) => ctx.actions.blurMouseToggle(event, button);
  const setIcon = (el: HTMLElement, svg: string) => ctx.actions.setIcon(el, svg);
  const setTooltipContent = (el: HTMLElement, raw: string) => ctx.actions.setTooltipContent(el, raw);
  const escapeHtml = (s: string) => ctx.actions.escapeHtml(s);
  const applyVolumeAndBoost = (video: HTMLVideoElement, slider: number) => ctx.actions.applyVolumeAndBoost(video, slider);
  const rememberAudibleVolume = (video: BoostedVideoElement, volume: number) => ctx.actions.rememberAudibleVolume(video, volume);
  const restoreAudibleVolume = (video: BoostedVideoElement) => ctx.actions.restoreAudibleVolume(video);
  const isVideoSilent = (video: HTMLVideoElement) => ctx.actions.isVideoSilent(video);
  const persistCaptionPreference = (pref: Parameters<typeof ctx.actions.persistCaptionPreference>[0]) => {
    ctx.actions.persistCaptionPreference(pref);
  };
  const persistCaptionStyle = (style: Parameters<typeof ctx.actions.persistCaptionStyle>[0]) => {
    ctx.actions.persistCaptionStyle(style);
  };
  const showCaptionHud = (payload: Parameters<typeof ctx.actions.showCaptionHud>[0]) => ctx.actions.showCaptionHud(payload);
  const executeCommand = (command: PlayerCommand) => ctx.actions.executeCommand(command);
  const exitTheaterMode = () => ctx.actions.exitTheaterMode();
  const showHelpOverlay = () => ctx.actions.showHelpOverlay();
  const findAllVideosDeep = (root?: Document | ShadowRoot) => ctx.actions.findAllVideosDeep(root);
  const seekHostTime = (video: HTMLVideoElement, time: number) => ctx.actions.seekHostTime(video, time);
  const tooltipState: TooltipState = { element: null };

  function bindCustomTooltip(button: HTMLButtonElement, getTooltipText: () => string): void {
    button.removeAttribute('title');

    const show = () => {
      if (!tooltipState.element) {
        tooltipState.element = document.createElement('div');
        tooltipState.element.className = 'theater-button-tooltip';
        paintOverlay(tooltipState.element);
        mountPlayerUi(tooltipState.element);
      }
    
      const rawText = getTooltipText();
      setTooltipContent(tooltipState.element, rawText);
      tooltipState.element.classList.add('visible');
    
      // Position
      const rect = button.getBoundingClientRect();
      const tooltipWidth = tooltipState.element.offsetWidth;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    
      let tooltipX = rect.left + rect.width / 2;
      const padding = 12;
      const minX = tooltipWidth / 2 + padding;
      const maxX = viewportWidth - (tooltipWidth / 2 + padding);
    
      // Clamp horizontal position to viewport bounds to prevent overflow
      if (tooltipX < minX) {
        tooltipX = minX;
      } else if (tooltipX > maxX) {
        tooltipX = maxX;
      }
    
      const tooltipY = rect.top - 8;
    
      tooltipState.element.style.left = `${tooltipX}px`;
      tooltipState.element.style.top = `${tooltipY}px`;
      updateCaptionDock();
    };

    const hide = () => {
      if (tooltipState.element) {
        tooltipState.element.classList.remove('visible');
        updateCaptionDock();
      }
    };

    button.addEventListener('mouseenter', show);
    button.addEventListener('mouseleave', hide);
    button.addEventListener('click', hide);
  }

  // Creates unified bottom player controls
  function createCustomControls(video: HTMLVideoElement): void {
    destroyCustomControls();

    const controlsScope = new DisposableScope();
    let gestureScope: DisposableScope | null = null;

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
    wrapper.addEventListener('pointerleave', () => {
      window.requestAnimationFrame(updateCaptionDock);
    });

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
    tooltip.className = 'theater-scrubber-tooltip';

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

    // Volume Container
    const volumeContainer = document.createElement('div');
    volumeContainer.className = 'theater-volume-container';
    volumeContainer.addEventListener('pointerenter', updateCaptionDock);
    volumeContainer.addEventListener('pointerleave', () => {
      window.requestAnimationFrame(updateCaptionDock);
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
    volumeSlider.max = refs.volumeBoostEnabled ? '1.5' : '1.0';
    volumeSlider.step = '0.05';
  
    const boostedVideo = video as BoostedVideoElement;
    if (video.volume > 0) rememberAudibleVolume(boostedVideo, video.volume);
    const initialLogical = boostedVideo._logicalVolume !== undefined
      ? boostedVideo._logicalVolume
      : (isVideoSilent(video) ? 0 : video.volume);
    volumeSlider.value = String(initialLogical);

    const volumeTick100 = document.createElement('div');
    volumeTick100.className = 'volume-tick-100-vertical';
    if (!refs.volumeBoostEnabled) {
      volumeTick100.style.display = 'none';
    }

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
      const logicalVol = video.muted ? 0 : (boostedVideo._logicalVolume !== undefined ? boostedVideo._logicalVolume : video.volume);
      if (video.muted || logicalVol === 0) {
        setIcon(volumeBtn, volMutedIcon);
        volumeBtn.style.color = '';
      } else if (logicalVol < 0.5) {
        setIcon(volumeBtn, volLowIcon);
        volumeBtn.style.color = '';
      } else {
        setIcon(volumeBtn, volHighIcon);
        if (logicalVol > 1.0 && video.dataset.theaterBoostReady === 'true') {
          volumeBtn.style.color = '#f59e0b';
        } else {
          volumeBtn.style.color = '';
        }
      }
    };
    updateVolumeIcon();

    const updateVolumeSliderFill = () => {
      const logicalVol = video.muted ? 0 : (boostedVideo._logicalVolume !== undefined ? boostedVideo._logicalVolume : video.volume);
      const fillPct = (logicalVol / (refs.volumeBoostEnabled ? 1.5 : 1.0)) * 100;
      const isBoosted = logicalVol > 1.0;
      const activeColor = isBoosted ? '#f59e0b' : 'var(--accent-color, #6366f1)';
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
      const logicalVol = video.muted ? 0 : (boostedVideo._logicalVolume !== undefined ? boostedVideo._logicalVolume : video.volume);
      if (logicalVol <= 1.0) {
        volumeTooltip.textContent = `${Math.round(logicalVol * 100)}%`;
        volumeTooltip.style.color = '#f8fafc';
      } else {
        const pct = Math.round(100 + (logicalVol - 1.0) * 400);
        volumeTooltip.textContent = `${pct}%`;
        volumeTooltip.style.color = '#f59e0b';
      }
    };
    updateVolumeTooltip();

    const onBoostReady = () => {
      updateVolumeIcon();
      updateVolumeSliderFill();
      updateVolumeTooltip();
    };
    window.addEventListener('theater-everywhere-boost-ready', onBoostReady);

    volumeBtn.addEventListener('click', (event) => {
      if (isVideoSilent(video)) {
        const restore = restoreAudibleVolume(boostedVideo);
        boostedVideo._logicalVolume = restore;
        rememberAudibleVolume(boostedVideo, restore);
        video.muted = false;
        applyVolumeAndBoost(boostedVideo, restore);
      } else {
        rememberAudibleVolume(boostedVideo, boostedVideo._logicalVolume ?? video.volume);
        boostedVideo._logicalVolume = boostedVideo._logicalVolume ?? video.volume;
        video.muted = true;
      }
      blurMouseToggle(event, volumeBtn);
    });

    volumeSlider.addEventListener('input', (e) => {
      let val = parseFloat((e.target as HTMLInputElement).value);
      if (Math.abs(val - 1.0) <= 0.05) {
        val = 1.0;
        volumeSlider.value = '1.0';
      }
      boostedVideo._logicalVolume = val;
      rememberAudibleVolume(boostedVideo, val);
      if (val > 0 && video.muted) {
        video.muted = false;
      }
      applyVolumeAndBoost(boostedVideo, val);
      updateVolumeSliderFill();
      updateVolumeTooltip();
    });

    volumeContainer.appendChild(volumeBtn);
    volumeContainer.appendChild(volumePanel);

    // Time label display
    const timeDisplay = document.createElement('span');
    timeDisplay.className = 'theater-time-display';
    timeDisplay.style.cursor = 'pointer';
    timeDisplay.textContent = '0:00 / 0:00';

    const formatTime = (secs: number): string => {
      if (isNaN(secs) || !isFinite(secs)) return '0:00';
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = Math.floor(secs % 60);
      const sStr = s < 10 ? '0' + s : String(s);
      if (h > 0) {
        const mStr = m < 10 ? '0' + m : String(m);
        return `${h}:${mStr}:${sStr}`;
      }
      return `${m}:${sStr}`;
    };

    let showRemainingTime = false;
    timeDisplay.addEventListener('click', (e) => {
      e.stopPropagation();
      const window = playbackWindow(video);
      if (window.live) {
        if (window.seekable) seekToLive(video);
        return;
      }
      showRemainingTime = !showRemainingTime;
      updateTimeDisplay();
    });

    const syncLiveChrome = () => {
      const window = playbackWindow(video);
      const locked = window.live && !window.seekable;
      const canJumpToLive = window.live && window.seekable;
      const behindLive = canJumpToLive && !isVideoAtLiveEdge(video, window);
      timeDisplay.classList.toggle('theater-time-live', window.live);
      timeDisplay.classList.toggle('theater-time-live-behind', behindLive);
      timeDisplay.classList.toggle('theater-time-live-jump', behindLive);
      timeDisplay.style.cursor = window.live && !canJumpToLive ? 'default' : 'pointer';
      timeDisplay.title = behindLive ? t('jumpToLive') : '';
      scrubberContainer.classList.toggle('theater-scrubber-live', window.live);
      scrubberContainer.classList.toggle('theater-scrubber-live-locked', locked);
      scrubberContainer.setAttribute('aria-disabled', locked ? 'true' : 'false');
      speedContainer.hidden = window.live;
      if (locked) tooltip.classList.remove('visible');
    };

    const updateTimeDisplay = () => {
      const window = playbackWindow(video);
      const cur = displayMediaTime(video);
      syncLiveChrome();
      if (window.live) {
        timeDisplay.textContent = t('liveBadge');
        return;
      }
      const dur = window.end;
      if (showRemainingTime) {
        const remaining = Math.max(0, dur - cur);
        timeDisplay.textContent = `-${formatTime(remaining)} / ${formatTime(dur)}`;
      } else {
        timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
      }
    };

    leftSec.appendChild(playPauseBtn);
    leftSec.appendChild(volumeContainer);
    leftSec.appendChild(timeDisplay);

    // Right Controls Section
    const rightSec = document.createElement('div');
    rightSec.className = 'theater-controls-right';

    // Playback Speed Controls
    const speedContainer = document.createElement('div');
    speedContainer.className = 'theater-speed-container';
    speedContainer.addEventListener('pointerenter', updateCaptionDock);
    speedContainer.addEventListener('pointerleave', () => {
      window.requestAnimationFrame(updateCaptionDock);
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
    if (!document.pictureInPictureEnabled) {
      pipBtn.style.display = 'none';
    }

    bindCustomTooltip(pipBtn, () => t('pictureInPictureTooltip', ui().shortcuts.togglePiP));

    setIcon(pipBtn, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect><rect x="13" y="11" width="7" height="7" rx="1" ry="1"></rect></svg>`);
    const syncPipButton = () => {
      pipBtn.classList.toggle('active', document.pictureInPictureElement === video);
    };
    syncPipButton();
    video.addEventListener('enterpictureinpicture', syncPipButton);
    video.addEventListener('leavepictureinpicture', syncPipButton);
    pipBtn.addEventListener('click', () => {
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(console.error);
      } else {
        video.requestPictureInPicture().catch(console.error);
      }
    });

    // Fullscreen Button
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.className = 'theater-control-btn fullscreen-btn';
  
    bindCustomTooltip(fullscreenBtn, () => {
      return document.fullscreenElement ? t('exitFullscreen') : t('fullscreenTooltip', ui().shortcuts.toggleFullscreen);
    });

    const enterFullscreenIcon = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
      </svg>
    `;
    const exitFullscreenIcon = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 14h6v6m10-6h-6v6M4 10h6V4m10 6h-6V4"></path>
      </svg>
    `;

    setIcon(fullscreenBtn, document.fullscreenElement ? exitFullscreenIcon : enterFullscreenIcon);

    let wasPlayingBeforeFullscreen = false;

    const toggleFullscreen = () => {
      wasPlayingBeforeFullscreen = !video.paused;
    
      const resumeIfPaused = () => {
        if (wasPlayingBeforeFullscreen && video.paused) {
          video.play().catch(console.error);
        }
      };

      if (document.fullscreenElement) {
        document.exitFullscreen()
          .then(() => {
            setTimeout(resumeIfPaused, 150);
          })
          .catch(console.error);
      } else {
        const target = session.element ? document.documentElement : (video.parentElement || video);
        target.requestFullscreen()
          .then(() => {
            setTimeout(resumeIfPaused, 150);
          })
          .catch(() => {
            video.requestFullscreen()
              .then(() => {
                setTimeout(resumeIfPaused, 150);
              })
              .catch(console.error);
          });
      }
    };
    refs.currentToggleFullscreen = toggleFullscreen;

    fullscreenBtn.addEventListener('click', () => {
      toggleFullscreen();
    });

    const onFullscreenChange = () => {
      setIcon(fullscreenBtn, document.fullscreenElement ? exitFullscreenIcon : enterFullscreenIcon);
      showToolbar();
      if (wasPlayingBeforeFullscreen && video.paused) {
        setTimeout(() => {
          if (video.paused) {
            video.play().catch(console.error);
          }
        }, 50);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);

    // Close Button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'theater-control-btn close-btn';
  
    bindCustomTooltip(closeBtn, () => {
      const toggleKey = escapeHtml((ui().shortcuts.toggle || 'T').toUpperCase());
      const exitKey = escapeHtml(ui().shortcuts.exit === 'Escape' ? 'Esc' : (ui().shortcuts.exit || 'Esc'));
      return t('exitTheaterModeTooltip', [toggleKey, exitKey]);
    });

    setIcon(closeBtn, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`);
    closeBtn.addEventListener('click', () => {
      exitTheaterMode();
    });

    // Subtitles / CC Button
    const ccBtn = document.createElement('button');
    ccBtn.className = 'theater-control-btn cc-btn';

    const ccMenu = document.createElement('div');
    ccMenu.className = 'theater-cc-menu';
    paintOverlay(ccMenu);
    wrapper.appendChild(ccMenu);

    const mediaFeatures = new MediaFeaturesController({
      video,
      ccBtn,
      ccMenu,
      scrubberTrack,
      t,
      onCaptionChange: updateCaptionDock,
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
      }
    });
    wrapper._mediaFeatures = mediaFeatures;
    mediaFeatures.setCaptionStyle(ui().captionStyle);
    void mediaFeatures.start();
    updateCaptionDock();

    bindCustomTooltip(ccBtn, () => {
      if (mediaFeatures.ccTooltip() === t('noSubtitlesAvailable')) return t('noSubtitlesAvailable');
      return t('subtitlesTooltip', ui().shortcuts.toggleCaptions);
    });

    setIcon(ccBtn, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M7 10a2 2 0 0 1 4 0v4a2 2 0 0 1-4 0M14 10a2 2 0 0 1 4 0v4a2 2 0 0 1-4 0"></path></svg>`);

    const handleTrackChange = () => {
      void mediaFeatures.refresh();
    };

    if (video.textTracks) {
      video.textTracks.addEventListener('change', handleTrackChange);
      video.textTracks.addEventListener('addtrack', handleTrackChange);
      video.textTracks.addEventListener('removetrack', handleTrackChange);
    }
    const onTrackElementLoad = () => { void mediaFeatures.refresh(); };
    video.querySelectorAll('track').forEach((trackEl) => {
      trackEl.addEventListener('load', onTrackElementLoad);
    });

    ccBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!ccMenu.classList.contains('visible')) {
        mediaFeatures.renderCcMenu();
        ccMenu.classList.add('visible');
        const rect = ccBtn.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        ccMenu.style.right = `${wrapperRect.right - rect.right}px`;
        ccMenu.style.bottom = `${rect.height + 10}px`;
      } else {
        ccMenu.classList.remove('visible');
      }
      updateCaptionDock();
    });

    const dismissPopoversIfOutside = (e: Event) => {
      const inCc = eventPathIncludes(e, ccMenu) || eventPathIncludes(e, ccBtn);
      const inVolume = eventPathMatches(e, '.theater-volume-container');
      const inSpeed = eventPathMatches(e, '.theater-speed-container');
      if (!inCc) ccMenu.classList.remove('visible');
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
    window.addEventListener('pointerdown', dismissPopoversIfOutside, true);
    window.addEventListener('click', dismissPopoversIfOutside, true);

    const onWindowBlur = () => {
      closeTheaterPopovers();
      updateCaptionDock();
    };
    window.addEventListener('blur', onWindowBlur);

    rightSec.appendChild(ccBtn);
    rightSec.appendChild(speedContainer);
    updateTimeDisplay();

    const fitBtn = document.createElement('button');
    fitBtn.className = 'theater-control-btn video-fit-btn';
    bindCustomTooltip(fitBtn, () => t('videoFitTooltip', ui().shortcuts.cycleFit));
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
    rightSec.appendChild(fitBtn);

    // Switch Video Button (Only if there are multiple real video players on the page)
    const videosOnPage = selectSwitchableVideos(findAllVideosDeep(document), video);
    if (videosOnPage.length > 1) {
      const switchVideoBtn = document.createElement('button');
      switchVideoBtn.className = 'theater-control-btn switch-video-btn';
      bindCustomTooltip(switchVideoBtn, () => t('switchVideoTooltip', ui().shortcuts.cycle));
      setIcon(switchVideoBtn, `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"></path>
        </svg>
      `);
      switchVideoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        executeCommand({ type: 'CYCLE_VIDEO', direction: 'next' });
      });
      rightSec.appendChild(switchVideoBtn);
    }

    rightSec.appendChild(pipBtn);
    rightSec.appendChild(fullscreenBtn);

    // Help Button (Keyboard shortcuts listing)
    const helpBtn = document.createElement('button');
    helpBtn.className = 'theater-control-btn help-btn';
    bindCustomTooltip(helpBtn, () => t('keyboardShortcutsTooltip', ui().shortcuts.showHelp));
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
    rightSec.appendChild(helpBtn);

    rightSec.appendChild(closeBtn);

    controlsRow.appendChild(leftSec);
    controlsRow.appendChild(scrubberContainer);
    controlsRow.appendChild(rightSec);
    controlsRow.appendChild(tooltip);

    wrapper.appendChild(controlsRow);

    mountPlayerUi(wrapper);

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

    const updateScrubber = () => {
      const window = playbackWindow(video);
      const cur = video.currentTime || 0;
      syncLiveChrome();

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
      scrubberHandle.style.left = `${pct}%`;
    };
    updateScrubber();

    const updateTooltip = (clientX: number) => {
      const window = playbackWindow(video);
      if (!window.seekable) return;
      const rect = scrubberContainer.getBoundingClientRect();
      if (rect.width === 0) return;
    
      const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const time = ratioToTime(pos, window);
      const extras = mediaFeatures.tooltipExtras(time);

      tooltip.replaceChildren();
      if (extras.preview) {
        const preview = document.createElement('div');
        preview.className = 'theater-scrubber-preview';
        const image = extras.preview.image;
        const displayWidth = PREVIEW_DISPLAY_WIDTH;
        const scale = displayWidth / image.tileWidth;
        preview.style.width = `${displayWidth}px`;
        preview.style.height = `${Math.round(image.tileHeight * scale)}px`;
        preview.style.backgroundImage = `url(${JSON.stringify(image.url)})`;
        preview.style.backgroundRepeat = 'no-repeat';
        preview.style.backgroundPosition = `-${Math.round(image.x * scale)}px -${Math.round(image.y * scale)}px`;
        preview.style.backgroundSize = `${Math.round(image.sheetWidth * scale)}px ${Math.round(image.sheetHeight * scale)}px`;
        tooltip.appendChild(preview);
      }
      if (extras.chapterTitle) {
        const chapterTitle = document.createElement('div');
        chapterTitle.className = 'theater-scrubber-chapter-title';
        chapterTitle.textContent = extras.chapterTitle;
        tooltip.appendChild(chapterTitle);
      }
      const timeLabel = document.createElement('div');
      timeLabel.className = 'theater-scrubber-time';
      timeLabel.textContent = window.live
        ? (isAtLiveEdge(time, window) || (window.end - time) > MAX_LIVE_DVR_SECONDS ? t('liveBadge') : `-${formatTime(Math.max(0, window.end - time))}`)
        : formatTime(time);
      tooltip.appendChild(timeLabel);

      const rowRect = controlsRow.getBoundingClientRect();
      const leftPx = (rect.left - rowRect.left) + pos * rect.width;
      tooltip.style.left = `${leftPx}px`;
      tooltip.classList.add('visible');
      updateCaptionDock();
    };

    let tooltipFrame = 0;
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
      if (!isDragging) {
        tooltip.classList.remove('visible');
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
    
      const targetTime = ratioToTime(pos, window);
      if (window.live) {
        timeDisplay.textContent = t('liveBadge');
        timeDisplay.classList.toggle(
          'theater-time-live-behind',
          window.seekable && !isAtLiveEdge(targetTime, window)
        );
      } else if (showRemainingTime) {
        const remaining = Math.max(0, window.end - targetTime);
        timeDisplay.textContent = `-${formatTime(remaining)} / ${formatTime(window.end)}`;
      } else {
        timeDisplay.textContent = `${formatTime(targetTime)} / ${formatTime(window.end)}`;
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
      isDragging = true;
      scrubberContainer.classList.add('dragging');
      handleSeekEvent(e.clientX, 'immediate');
    
      const onMouseMove = (moveEvt: MouseEvent) => {
        handleSeekEvent(moveEvt.clientX, 'throttled');
      };

      const onMouseUp = (upEvt: MouseEvent) => {
        handleSeekEvent(upEvt.clientX, 'immediate');
      
        const onSeeked = () => {
          isDragging = false;
          scrubberContainer.classList.remove('dragging');
          video.removeEventListener('seeked', onSeeked);
        
          // Hide tooltip if cursor is not over the scrubber container
          const rect = scrubberContainer.getBoundingClientRect();
          if (
            upEvt.clientX < rect.left ||
            upEvt.clientX > rect.right ||
            upEvt.clientY < rect.top ||
            upEvt.clientY > rect.bottom
          ) {
            tooltip.classList.remove('visible');
          }
        };
        video.addEventListener('seeked', onSeeked);
      
        controlsScope.timeout(() => {
          isDragging = false;
          scrubberContainer.classList.remove('dragging');
          video.removeEventListener('seeked', onSeeked);
        
          // Hide tooltip if cursor is not over the scrubber container
          const rect = scrubberContainer.getBoundingClientRect();
          if (
            upEvt.clientX < rect.left ||
            upEvt.clientX > rect.right ||
            upEvt.clientY < rect.top ||
            upEvt.clientY > rect.bottom
          ) {
            tooltip.classList.remove('visible');
          }
        }, 150);

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
      isDragging = true;
      scrubberContainer.classList.add('dragging');
      handleSeekEvent(e.touches[0].clientX, 'immediate');

      const onTouchMove = (moveEvt: TouchEvent) => {
        if (moveEvt.touches.length === 1) {
          handleSeekEvent(moveEvt.touches[0].clientX, 'throttled');
        }
      };

      const onTouchEnd = (endEvt: TouchEvent) => {
        if (endEvt.changedTouches.length === 1) {
          handleSeekEvent(endEvt.changedTouches[0].clientX, 'immediate');
        }
        const onSeeked = () => {
          isDragging = false;
          scrubberContainer.classList.remove('dragging');
          video.removeEventListener('seeked', onSeeked);
          tooltip.classList.remove('visible');
        };
        video.addEventListener('seeked', onSeeked);
      
        controlsScope.timeout(() => {
          isDragging = false;
          scrubberContainer.classList.remove('dragging');
          video.removeEventListener('seeked', onSeeked);
          tooltip.classList.remove('visible');
        }, 150);

        gestureScope?.dispose();
        gestureScope = null;
      };

      gestureScope?.dispose();
      gestureScope = new DisposableScope();
      gestureScope.listen(document, 'touchmove', onTouchMove, { capture: true, passive: true });
      gestureScope.listen(document, 'touchend', onTouchEnd, true);
    };
    scrubberContainer.addEventListener('touchstart', onScrubberTouchStart, { passive: true });

    // Buffering / Loading State Helper
    let bufferingTimeout: number | null = null;

    const setBuffering = (isBuffering: boolean) => {
      if (isBuffering) {
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

    let lastDisneyPlayhead = Number.NaN;
    const onDisneyClock = () => {
      const playhead = Number(video.dataset.teDisneyPlayhead);
      updateScrubber();
      updateTimeDisplay();
      mediaFeatures.updateTime(displayMediaTime(video));
      updateCaptionDock();
      if (Number.isFinite(playhead) && Number.isFinite(lastDisneyPlayhead) && Math.abs(playhead - lastDisneyPlayhead) > 0.04) {
        setBuffering(false);
      }
      if (Number.isFinite(playhead)) lastDisneyPlayhead = playhead;
    };

    // Event hookups
    const onPlay = () => {
      setIcon(playPauseBtn, pauseIcon);
      setBuffering(false);
    };
    const onPause = () => { setIcon(playPauseBtn, playIcon); };
    let lastMediaHref = window.location.href;
    const onTimeUpdate = () => { 
      updateScrubber(); 
      updateTimeDisplay();
      mediaFeatures.updateTime(displayMediaTime(video));
      updateCaptionDock();
      if (!video.paused && !video.seeking && video.readyState >= 3) {
        setBuffering(false);
      }
      const playhead = Number(video.dataset.teDisneyPlayhead);
      if (!video.paused && Number.isFinite(playhead) && Number.isFinite(lastDisneyPlayhead) && Math.abs(playhead - lastDisneyPlayhead) > 0.04) {
        setBuffering(false);
      }
      if (window.location.href !== lastMediaHref) {
        lastMediaHref = window.location.href;
        void mediaFeatures.refresh();
      }
    };
    const onProgress = () => { updateScrubber(); };
    const onDurationChange = () => {
      updateScrubber();
      updateTimeDisplay();
      if (Number.isFinite(video.duration)) void mediaFeatures.refresh();
    };
    const onMediaReset = () => {
      clearPendingMediaSeek(video);
      if (!mediaFeatures.retainCaptionsOnElementReset()) {
        mediaFeatures.invalidate();
      }
      tooltip.classList.remove('visible');
      tooltip.replaceChildren();
      updateScrubber();
      updateTimeDisplay();
      updateCaptionDock();
    };
    const onPageMediaChange = () => {
      void mediaFeatures.refresh();
    };
    const onVolumeChange = () => {
      const boostedVideo = video as BoostedVideoElement;
      if (video.muted) {
        volumeSlider.value = '0';
      } else {
        if (boostedVideo._logicalVolume !== undefined && boostedVideo._logicalVolume > 1.0 && video.volume === 1.0) {
          // Keep the slider at the logical volume if currently boosted
          volumeSlider.value = String(boostedVideo._logicalVolume);
          rememberAudibleVolume(boostedVideo, boostedVideo._logicalVolume);
        } else {
          boostedVideo._logicalVolume = video.volume;
          volumeSlider.value = String(video.volume);
          rememberAudibleVolume(boostedVideo, video.volume);
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
        if (!video.paused || Number.isFinite(Number(video.dataset.teDisneyPlayhead))) {
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
      updateScrubber(); 
      updateTimeDisplay(); 
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
    document.addEventListener('yt-navigate-finish', onPageMediaChange);
    window.addEventListener('theater-everywhere-twitch-harvest', onPageMediaChange);
    window.addEventListener('theater-everywhere-disney-harvest', onPageMediaChange);
    window.addEventListener(DISNEY_CLOCK_EVENT, onDisneyClock);
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
      controlsScope.dispose();
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('progress', onProgress);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('loadedmetadata', onDurationChange);
      video.removeEventListener('emptied', onMediaReset);
      document.removeEventListener('yt-navigate-finish', onPageMediaChange);
      window.removeEventListener('theater-everywhere-twitch-harvest', onPageMediaChange);
      window.removeEventListener('theater-everywhere-disney-harvest', onPageMediaChange);
      window.removeEventListener(DISNEY_CLOCK_EVENT, onDisneyClock);
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
      if (video.textTracks) {
        video.textTracks.removeEventListener('change', handleTrackChange);
        video.textTracks.removeEventListener('addtrack', handleTrackChange);
        video.textTracks.removeEventListener('removetrack', handleTrackChange);
      }
      video.querySelectorAll('track').forEach((trackEl) => {
        trackEl.removeEventListener('load', onTrackElementLoad);
      });
      mediaFeatures.dispose();
      wrapper._mediaFeatures = undefined;
      window.removeEventListener('pointerdown', dismissPopoversIfOutside, true);
      window.removeEventListener('click', dismissPopoversIfOutside, true);
      window.removeEventListener('blur', onWindowBlur);
      loadingIndicator.remove();
    };

    // Reveal controls for mouse, touch, pen, and keyboard users.
    document.addEventListener('pointermove', showToolbar, { passive: true });
    document.addEventListener('pointerdown', showToolbar, { passive: true });
    wrapper.addEventListener('focusin', showToolbar);
    showToolbar();
  }

  // Cleans up custom controls
  function destroyCustomControls(): void {
    const wrapper = queryPlayerUi('.theater-controls-wrapper') as ExtendedHTMLDivElement | null;
    if (wrapper?._videoListenersCleanup) {
      wrapper._videoListenersCleanup();
    }

    tooltipState.element = null;

    document.removeEventListener('pointermove', showToolbar);
    document.removeEventListener('pointerdown', showToolbar);
    if (refs.toolbarTimer) {
      clearTimeout(refs.toolbarTimer);
      refs.toolbarTimer = null;
    }
    refs.toolbarKeyboardInteractionActive = false;
    document.documentElement.classList.remove(CURSOR_HIDDEN_CLASS);
    destroyPlayerUi();
    refs.currentToggleFullscreen = null;
  }

  return { bindCustomTooltip, createCustomControls, destroyCustomControls };
}
