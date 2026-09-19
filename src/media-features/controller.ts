import { normalizeCaptionLabel, normalizeLanguageCode, pickCaptionTrack, type CaptionLanguageChoice, type CaptionLanguagePreference } from './caption-preference';
import { CaptionRenderer } from './caption-renderer';
import { openCaptionOptionsDialog } from './caption-options-dialog';
import { chapterAtTime } from './cue-index';
import type { CaptionStyle } from './caption-style';
import { DEFAULT_CAPTION_STYLE } from './caption-style';
import { defaultMediaProviderFlags, mediaProviderFlagsEqual, type MediaProviderFlags } from './provider-flags';
import { createMediaFeaturesAdapter } from './resolve-adapter';
import { displayMediaTime } from '../playback-window';
import { heatmapRidgePath } from './parsers/youtube-heatmap-path';
import type { CaptionActivationResult, CaptionTrack, Chapter, MediaFeaturesAdapter, PreviewFrame, TimelineHeatmap } from './types';
import type { MediaSnapshot } from '../core/media-snapshot';
import { providerError } from '../core/errors';

export type CaptionToggleResult = 'on' | 'off' | 'none' | 'failed';

export type CaptionHudPayload = {
  result: CaptionToggleResult | 'loading' | 'dismiss';
  label?: string;
};

export type CaptionActivateOptions = {
  persist?: boolean;
  hud?: boolean | 'on';
};

export type CaptionOverlayRenderer = Pick<CaptionRenderer, 'setCues' | 'update' | 'setStyle' | 'dispose'>;

export type MediaFeaturesBindings = {
  video: HTMLVideoElement;
  ccBtn: HTMLButtonElement;
  ccMenu: HTMLDivElement;
  scrubberTrack: HTMLElement;
  t: (key: string, substitutions?: string | string[]) => string;
  onCaptionChange?: () => void;
  onCaptionHud?: (payload: CaptionHudPayload) => void;
  onCaptionStyleChange?: (style: CaptionStyle) => void;
  captionPreference?: CaptionLanguagePreference | null;
  onCaptionPreferenceChange?: (pref: CaptionLanguagePreference) => void;
  providerFlags?: MediaProviderFlags;
  decorateCaptionDialog?: (overlay: HTMLElement) => void;
  adapter?: MediaFeaturesAdapter;
  renderer?: CaptionOverlayRenderer;
  onSnapshot?: (snapshot: MediaSnapshot) => void;
};

function setOverlayCaptionsClass(on: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('theater-using-overlay-captions', on);
}

export type TooltipMediaExtras = {
  chapterTitle: string;
  preview: PreviewFrame | null;
};

export class MediaFeaturesController {
  private adapter: MediaFeaturesAdapter;
  private renderer: CaptionOverlayRenderer;
  private video: HTMLVideoElement;
  private ccBtn: HTMLButtonElement;
  private ccMenu: HTMLDivElement;
  private chapterLayer: HTMLDivElement;
  private heatmapLayer: SVGSVGElement;
  private heatmapHasData = false;
  private heatmap: TimelineHeatmap | null = null;
  private t: MediaFeaturesBindings['t'];
  private tracks: CaptionTrack[] = [];
  private chapters: Chapter[] = [];
  private activeTrackId: string | null = null;
  private captionState: 'off' | 'loading' | 'active' = 'off';
  private usingOverlayCaptions = false;
  private disposed = false;
  private refreshInFlight = false;
  private refreshQueued = false;
  private mediaId: string | null = null;
  private captionPreference: CaptionLanguageChoice | null = null;
  private lastLanguagePref: CaptionLanguageChoice | null = null;
  private captionStyle: CaptionStyle = { ...DEFAULT_CAPTION_STYLE };
  private onCaptionChange?: () => void;
  private onCaptionHud?: (payload: CaptionHudPayload) => void;
  private onCaptionStyleChange?: (style: CaptionStyle) => void;
  private onCaptionPreferenceChange?: (pref: CaptionLanguagePreference) => void;
  private decorateCaptionDialog?: (overlay: HTMLElement) => void;
  private providerFlags: MediaProviderFlags = defaultMediaProviderFlags();
  private onSnapshot?: (snapshot: MediaSnapshot) => void;
  private opChain: Promise<void> = Promise.resolve();
  private activateGeneration = 0;
  private sessionEpoch = 0;
  private activateInFlight = false;
  private captionCueRefreshInFlight = false;
  private lastCaptionCueRefreshAt = 0;
  private lastCaptionCueTime = Number.NaN;
  private captionDiagnostics: Array<Record<string, unknown>> = [];
  private dialogAbort = new AbortController();

  constructor(bindings: MediaFeaturesBindings) {
    this.providerFlags = bindings.providerFlags || defaultMediaProviderFlags();
    this.adapter = bindings.adapter || createMediaFeaturesAdapter(bindings.video, this.providerFlags);
    this.renderer = bindings.renderer || new CaptionRenderer(bindings.onCaptionChange);
    this.video = bindings.video;
    this.ccBtn = bindings.ccBtn;
    this.ccMenu = bindings.ccMenu;
    this.t = bindings.t;
    this.onCaptionChange = bindings.onCaptionChange;
    this.onCaptionHud = bindings.onCaptionHud;
    this.onCaptionStyleChange = bindings.onCaptionStyleChange;
    this.onCaptionPreferenceChange = bindings.onCaptionPreferenceChange;
    this.decorateCaptionDialog = bindings.decorateCaptionDialog;
    this.onSnapshot = bindings.onSnapshot;
    const pref = bindings.captionPreference;
    if (pref && (pref.language || pref.label)) {
      this.lastLanguagePref = {
        language: pref.language,
        autoGenerated: pref.autoGenerated,
        ...(pref.label ? { label: pref.label } : {})
      };
      if (pref.enabled) this.captionPreference = this.lastLanguagePref;
    }
    if (typeof document === 'undefined') {
      this.chapterLayer = {
        className: '',
        replaceChildren() {},
        remove() {},
        appendChild() { return null; }
      } as unknown as HTMLDivElement;
      this.heatmapLayer = {
        className: '',
        classList: { add() {}, remove() {}, toggle() { return false; } },
        style: { setProperty() {}, removeProperty() {} },
        replaceChildren() {},
        remove() {},
        appendChild() { return null; },
        setAttribute() {},
        closest() { return null; }
      } as unknown as SVGSVGElement;
    } else {
      this.chapterLayer = document.createElement('div');
      this.chapterLayer.className = 'theater-scrubber-chapters';
      bindings.scrubberTrack.appendChild(this.chapterLayer);
      this.heatmapLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.heatmapLayer.setAttribute('class', 'theater-scrubber-heatmap');
      this.heatmapLayer.setAttribute('viewBox', '0 0 1000 100');
      this.heatmapLayer.setAttribute('preserveAspectRatio', 'none');
      this.heatmapLayer.setAttribute('width', '100%');
      this.heatmapLayer.setAttribute('height', '100%');
      this.heatmapLayer.setAttribute('aria-hidden', 'true');
      this.heatmapLayer.setAttribute('overflow', 'visible');
      const heatmapHost = bindings.scrubberTrack.parentElement || bindings.scrubberTrack;
      heatmapHost.insertBefore(this.heatmapLayer, heatmapHost.firstChild);
    }
  }

  setHeatmapHover(ratio: number | null): void {
    if (typeof document === 'undefined') return;
    if (ratio == null || !Number.isFinite(ratio) || !this.heatmapHasData) {
      this.heatmapLayer.style.removeProperty('--theater-heatmap-hover');
      this.heatmapLayer.classList.remove('theater-scrubber-heatmap-scrubbing');
      return;
    }
    const pct = Math.max(0, Math.min(1, ratio)) * 100;
    this.heatmapLayer.style.setProperty('--theater-heatmap-hover', `${pct}%`);
    this.heatmapLayer.classList.add('theater-scrubber-heatmap-scrubbing');
  }

  async start(): Promise<void> {
    await this.refresh();
  }

  setProviderFlags(flags: MediaProviderFlags): void {
    if (this.disposed || mediaProviderFlagsEqual(this.providerFlags, flags)) return;
    this.providerFlags = flags;
    this.rebindAdapter(createMediaFeaturesAdapter(this.video, flags));
  }

  rebindAdapter(adapter: MediaFeaturesAdapter): void {
    if (this.disposed) return;
    this.adapter.dispose();
    this.adapter = adapter;
    this.invalidate();
    void this.refresh();
  }

  invalidate(): void {
    if (this.disposed) return;
    this.bumpEpoch();
    this.adapter.invalidate?.();
    void this.adapter.activateCaptionTrack(null);
    this.tracks = [];
    this.chapters = [];
    this.heatmap = null;
    this.activeTrackId = null;
    this.captionState = 'off';
    this.usingOverlayCaptions = false;
    this.renderer.setCues([]);
    setOverlayCaptionsClass(false);
    this.renderChapterMarks();
    this.renderHeatmap();
    this.updateCcState();
    this.renderCcMenu();
    this.onCaptionChange?.();
  }

  private bumpEpoch(): void {
    this.sessionEpoch += 1;
    this.activateGeneration += 1;
    if (!this.dialogAbort.signal.aborted) this.dialogAbort.abort();
    this.dialogAbort = new AbortController();
  }

  private recordCaptionTransition(reason: string, details: Record<string, unknown> = {}): void {
    const track = this.activeTrackId
      ? this.tracks.find((item) => item.id === this.activeTrackId)
      : undefined;
    const entry = {
      at: Date.now(),
      reason,
      mediaId: this.mediaId,
      trackId: this.activeTrackId,
      state: this.captionState,
      generation: this.activateGeneration,
      provider: track?.source || null,
      ...details
    };
    this.captionDiagnostics.push(entry);
    if (this.captionDiagnostics.length > 20) this.captionDiagnostics.shift();
    console.debug('[Theater Everywhere] Caption state:', entry);
  }

  private isCurrent(epoch: number, adapter: MediaFeaturesAdapter): boolean {
    return !this.disposed && this.sessionEpoch === epoch && this.adapter === adapter;
  }

  private delay(ms: number, epoch: number, adapter: MediaFeaturesAdapter): Promise<boolean> {
    return new Promise((resolve) => {
      setTimeout(() => resolve(this.isCurrent(epoch, adapter)), ms);
    });
  }

  /**
   * Reloads media metadata and publishes a snapshot for the current adapter epoch.
   * Concurrent requests queue one follow-up refresh, and stale adapter results are ignored.
   */
  async refresh(): Promise<void> {
    if (this.disposed) return;
    if (this.refreshInFlight) {
      this.refreshQueued = true;
      return;
    }
    this.refreshInFlight = true;
    const epoch = this.sessionEpoch;
    const adapter = this.adapter;
    const previousId = this.mediaId;
    const errors: MediaSnapshot['errors'] = [];
    try {
      try {
        await adapter.reload?.();
        if (!this.isCurrent(epoch, adapter)) return;
        this.mediaId = adapter.mediaId?.() || null;
        this.tracks = await adapter.listCaptionTracks();
        if (!this.isCurrent(epoch, adapter)) return;
        this.chapters = adapter.getChapters ? await adapter.getChapters() : [];
        if (!this.isCurrent(epoch, adapter)) return;
        try {
          this.heatmap = adapter.getHeatmap ? adapter.getHeatmap() : null;
        } catch {
          this.heatmap = null;
        }
      } catch (err) {
        if (!this.isCurrent(epoch, adapter)) return;
        console.error('[Theater Everywhere] Media features probe failed:', err);
        this.tracks = [];
        this.chapters = [];
        this.heatmap = null;
        errors.push(providerError('network-failed', { capability: 'captions', cause: err, epoch }));
      }
      if (!this.isCurrent(epoch, adapter)) return;
      const mediaChanged = previousId !== this.mediaId;
      const activeTrackMissing = Boolean(this.activeTrackId && !this.tracks.some((track) => track.id === this.activeTrackId));
      if (mediaChanged || activeTrackMissing) {
        this.activateGeneration += 1;
        if (activeTrackMissing) void adapter.activateCaptionTrack(null);
        this.activeTrackId = null;
        this.captionState = 'off';
        this.usingOverlayCaptions = false;
        this.renderer.setCues([]);
        setOverlayCaptionsClass(false);
        this.recordCaptionTransition(mediaChanged ? 'media-changed' : 'track-missing', { previousId });
      }
      this.renderChapterMarks();
      this.renderHeatmap();
      this.updateCcState();
      this.renderCcMenu();
      const shouldRestoreCaptions = Boolean(this.captionPreference)
        && !this.activateInFlight
        && (mediaChanged || !this.captionsAreOn());
      if (shouldRestoreCaptions) {
        let match = pickCaptionTrack(this.tracks, this.captionPreference);
        if (!match) {
          if (!await this.delay(700, epoch, adapter) || !this.captionPreference) return;
          try {
            this.tracks = await adapter.listCaptionTracks();
          } catch {
            if (!this.isCurrent(epoch, adapter)) return;
            this.tracks = [];
          }
          if (!this.isCurrent(epoch, adapter)) return;
          this.updateCcState();
          this.renderCcMenu();
          match = pickCaptionTrack(this.tracks, this.captionPreference);
        }
        if (match) {
          await this.activate(match.id, { persist: false, hud: 'on' });
          if (!this.usingOverlayCaptions && this.isCurrent(epoch, adapter)) {
            if (!await this.delay(700, epoch, adapter) || !this.captionPreference) return;
            await this.activate(match.id, { persist: false, hud: 'on' });
          }
        }
      }
    } finally {
      if (this.isCurrent(epoch, adapter)) {
        this.onSnapshot?.({
          capabilities: {
            captions: this.tracks.length > 0,
            chapters: this.chapters.length > 0,
            previews: false
          },
          tracks: this.tracks,
          chapters: this.chapters,
          errors
        });
      }
      this.refreshInFlight = false;
      if (this.refreshQueued && !this.disposed) {
        this.refreshQueued = false;
        await this.refresh();
      }
    }
  }

  private renderChapterMarks(): void {
    this.chapterLayer.replaceChildren();
    if (typeof document === 'undefined') return;
    const duration = this.video.duration;
    if (!Number.isFinite(duration) || duration <= 0 || this.chapters.length === 0) return;
    for (const chapter of this.chapters) {
      if (chapter.start <= 0) continue;
      const mark = document.createElement('div');
      mark.className = 'theater-scrubber-chapter-mark';
      mark.style.left = `${(chapter.start / duration) * 100}%`;
      this.chapterLayer.appendChild(mark);
    }
  }

  private renderHeatmap(): void {
    this.heatmapLayer.replaceChildren();
    const pathData = this.heatmap?.svgPath || '';
    this.heatmapHasData = Boolean(pathData);
    this.syncHeatmapPresence();
    if (!this.heatmapHasData) {
      this.setHeatmapHover(null);
      this.heatmapLayer.classList.remove('theater-scrubber-heatmap-ready');
      return;
    }
    if (typeof document === 'undefined') return;
    const ns = 'http://www.w3.org/2000/svg';
    const svgEl = (name: string) => document.createElementNS(ns, name);
    const defs = svgEl('defs');
    const addFillGradient = (id: string, stopClass: string): void => {
      const gradient = svgEl('linearGradient');
      gradient.setAttribute('id', id);
      gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
      gradient.setAttribute('x1', '0');
      gradient.setAttribute('y1', '100');
      gradient.setAttribute('x2', '0');
      gradient.setAttribute('y2', '0');
      const bottom = svgEl('stop');
      bottom.setAttribute('offset', '0');
      bottom.setAttribute('class', stopClass);
      bottom.setAttribute('stop-opacity', '0');
      const hold = svgEl('stop');
      hold.setAttribute('offset', '0.1');
      hold.setAttribute('class', stopClass);
      hold.setAttribute('stop-opacity', '0');
      const top = svgEl('stop');
      top.setAttribute('offset', '1');
      top.setAttribute('class', stopClass);
      top.setAttribute('stop-opacity', '0.7');
      gradient.append(bottom, hold, top);
      defs.appendChild(gradient);
    };
    addFillGradient('theater-heatmap-fill', 'theater-heatmap-fill-white');
    addFillGradient('theater-heatmap-fill-accent', 'theater-heatmap-fill-accent');

    const mask = svgEl('mask');
    mask.setAttribute('id', 'theater-heatmap-glow-mask');
    mask.setAttribute('maskUnits', 'userSpaceOnUse');
    mask.setAttribute('maskContentUnits', 'userSpaceOnUse');
    mask.setAttribute('x', '-200');
    mask.setAttribute('y', '-50');
    mask.setAttribute('width', '1400');
    mask.setAttribute('height', '160');
    const maskBg = svgEl('rect');
    maskBg.setAttribute('x', '-200');
    maskBg.setAttribute('y', '-50');
    maskBg.setAttribute('width', '1400');
    maskBg.setAttribute('height', '160');
    maskBg.setAttribute('fill', '#ffffff');
    const maskCut = svgEl('path');
    maskCut.setAttribute('d', pathData);
    maskCut.setAttribute('fill', '#000000');
    mask.append(maskBg, maskCut);
    defs.appendChild(mask);

    const ridge = heatmapRidgePath(pathData) || pathData;
    const glowGroup = svgEl('g');
    glowGroup.setAttribute('mask', 'url(#theater-heatmap-glow-mask)');
    const glowBlur = svgEl('g');
    glowBlur.setAttribute('class', 'theater-scrubber-heatmap-glow-layer');
    const glowPad = svgEl('rect');
    glowPad.setAttribute('x', '-200');
    glowPad.setAttribute('y', '-50');
    glowPad.setAttribute('width', '1400');
    glowPad.setAttribute('height', '160');
    glowPad.setAttribute('fill', 'transparent');
    const glow = svgEl('path');
    glow.setAttribute('class', 'theater-scrubber-heatmap-glow');
    glow.setAttribute('d', ridge);
    glowBlur.append(glowPad, glow);
    glowGroup.appendChild(glowBlur);

    const remaining = svgEl('g');
    remaining.setAttribute('class', 'theater-scrubber-heatmap-remaining');
    const fill = svgEl('path');
    fill.setAttribute('class', 'theater-scrubber-heatmap-path');
    fill.setAttribute('d', pathData);
    fill.setAttribute('fill', 'url(#theater-heatmap-fill)');
    const stroke = svgEl('path');
    stroke.setAttribute('class', 'theater-scrubber-heatmap-stroke');
    stroke.setAttribute('d', ridge);
    remaining.append(fill, stroke);

    const played = svgEl('g');
    played.setAttribute('class', 'theater-scrubber-heatmap-played');
    const playedFill = svgEl('path');
    playedFill.setAttribute('class', 'theater-scrubber-heatmap-path');
    playedFill.setAttribute('d', pathData);
    playedFill.setAttribute('fill', 'url(#theater-heatmap-fill-accent)');
    const playedStroke = svgEl('path');
    playedStroke.setAttribute('class', 'theater-scrubber-heatmap-stroke');
    playedStroke.setAttribute('d', ridge);
    played.append(playedFill, playedStroke);

    this.heatmapLayer.append(defs, glowGroup, remaining, played);
    this.heatmapLayer.classList.add('theater-scrubber-heatmap-ready');
    this.syncHeatmapPresence();
  }

  private syncHeatmapPresence(): void {
    if (typeof document === 'undefined') return;
    const chrome = this.heatmapLayer.closest('.theater-controls-wrapper');
    chrome?.classList.toggle('theater-has-heatmap', this.heatmapHasData);
  }

  private captionsAreOn(): boolean {
    return this.captionState === 'active' && this.activeTrackId !== null;
  }

  private updateCcState(): void {
    const hasTracks = this.tracks.length > 0;
    this.ccBtn.classList.toggle('disabled', !hasTracks);
    this.ccBtn.style.opacity = hasTracks ? '' : '0.35';
    this.ccBtn.style.pointerEvents = hasTracks ? '' : 'none';
    this.ccBtn.classList.toggle('active', this.captionsAreOn());
  }

  setCaptionStyle(style: CaptionStyle): void {
    this.captionStyle = style;
    this.renderer.setStyle(style);
  }

  renderCcMenu(): void {
    if (typeof document === 'undefined') return;
    this.ccMenu.replaceChildren();

    const header = document.createElement('div');
    header.className = 'theater-cc-menu-header';
    const title = document.createElement('span');
    title.className = 'theater-cc-menu-title';
    title.textContent = this.t('subtitlesMenuTitle');
    const optionsBtn = document.createElement('button');
    optionsBtn.type = 'button';
    optionsBtn.className = 'theater-cc-menu-options';
    optionsBtn.textContent = this.t('subtitleOptions');
    optionsBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.openCaptionOptions();
    });
    header.append(title, optionsBtn);

    const list = document.createElement('div');
    list.className = 'theater-cc-menu-list';
    list.appendChild(header);

    if (this.tracks.length === 0) {
      const item = document.createElement('div');
      item.className = 'theater-cc-menu-item';
      item.textContent = this.t('noSubtitles');
      item.style.opacity = '0.5';
      item.style.cursor = 'default';
      list.appendChild(item);
      this.ccMenu.appendChild(list);
      return;
    }

    list.appendChild(this.menuItem(this.t('subtitlesOff'), !this.captionsAreOn(), () => {
      void this.activate(null, { hud: true });
    }));

    for (const track of this.tracks) {
      const label = this.captionTrackDisplayLabel(track);
      list.appendChild(this.menuItem(label, this.captionsAreOn() && this.activeTrackId === track.id, () => {
        void this.activate(track.id, { hud: true });
      }));
    }
    this.ccMenu.appendChild(list);
  }

  private captionTrackDisplayLabel(track: CaptionTrack): string {
    const baseLabel = track.label || track.language || this.t('trackLabel', '1');
    return track.autoGenerated && !/auto/i.test(baseLabel)
      ? this.t('autoGeneratedTrack', baseLabel)
      : baseLabel;
  }

  private emitCaptionHud(result: CaptionToggleResult, hud?: boolean | 'on'): void {
    if (!this.onCaptionHud) return;
    if (hud === false || hud == null) return;
    if (hud === 'on' && result !== 'on') return;
    const track = result === 'on' && this.activeTrackId
      ? this.tracks.find((item) => item.id === this.activeTrackId)
      : undefined;
    this.onCaptionHud({
      result,
      ...(track ? { label: this.captionTrackDisplayLabel(track) } : {})
    });
  }

  private async openCaptionOptions(): Promise<void> {
    this.ccMenu.classList.remove('visible');
    this.onCaptionChange?.();
    await openCaptionOptionsDialog({
      t: this.t,
      style: this.captionStyle,
      signal: this.dialogAbort.signal,
      onChange: (style) => {
        this.setCaptionStyle(style);
        this.onCaptionStyleChange?.(style);
      },
      decorate: this.decorateCaptionDialog
    });
  }

  private menuItem(label: string, active: boolean, onClick: () => void): HTMLButtonElement {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'theater-cc-menu-item';
    item.textContent = label;
    if (active) {
      item.classList.add('active');
      const checkIcon = document.createElement('span');
      checkIcon.textContent = '✓';
      checkIcon.style.marginLeft = '8px';
      item.appendChild(checkIcon);
    }
    item.addEventListener('click', () => {
      onClick();
      this.ccMenu.classList.remove('visible');
    });
    return item;
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.opChain.then(fn, fn);
    this.opChain = run.then(() => undefined, () => undefined);
    return run;
  }

  private persistAfterActivate(id: string | null, on: boolean, persist: boolean): void {
    const track = on && id ? this.tracks.find((item) => item.id === id) : undefined;
    if (on && track) {
      const language = normalizeLanguageCode(track.language);
      const label = normalizeCaptionLabel(track.label);
      if (!language && !label) return;
      const choice: CaptionLanguageChoice = language
        ? { language, autoGenerated: Boolean(track.autoGenerated) }
        : { language: '', autoGenerated: Boolean(track.autoGenerated), label };
      this.captionPreference = choice;
      this.lastLanguagePref = choice;
      if (persist) {
        this.onCaptionPreferenceChange?.({
          enabled: true,
          ...choice
        });
      }
      return;
    }
    if (id === null) {
      const previous = this.captionPreference || this.lastLanguagePref;
      this.captionPreference = null;
      if (persist) {
        this.onCaptionPreferenceChange?.({
          enabled: false,
          language: previous?.language || '',
          autoGenerated: Boolean(previous?.autoGenerated),
          ...(previous?.label ? { label: previous.label } : {})
        });
      }
    }
  }

  private async activateUnlocked(id: string | null, options?: CaptionActivateOptions): Promise<CaptionToggleResult> {
    if (this.disposed) return this.captionsAreOn() ? 'on' : 'off';
    const gen = ++this.activateGeneration;
    this.activateInFlight = true;
    this.captionState = id ? 'loading' : 'off';
    this.updateCcState();
    const persist = options?.persist !== false;
    if (id && options?.hud === true) {
      this.onCaptionHud?.({ result: 'loading' });
    }
    try {
      let activation: CaptionActivationResult = { status: 'failed', delivery: 'none', cues: [] };
      try {
        activation = await this.adapter.activateCaptionTrack(id);
      } catch (err) {
        console.error('[Theater Everywhere] Caption activate failed:', err);
        activation = { status: 'failed', delivery: 'none', cues: [] };
      }
      if (this.disposed || gen !== this.activateGeneration) {
        return this.captionsAreOn() ? 'on' : 'off';
      }
      const selected = id ? this.tracks.find((item) => item.id === id) : undefined;
      let on = Boolean(id && selected && activation.status === 'active');
      if (id && !on) {
        try {
          await this.adapter.activateCaptionTrack(null);
        } catch (err) {
          console.error('[Theater Everywhere] Caption deactivate failed:', err);
        }
        if (this.disposed || gen !== this.activateGeneration) {
          return this.captionsAreOn() ? 'on' : 'off';
        }
        activation = { status: 'failed', delivery: 'none', cues: [] };
      }
      this.activeTrackId = on ? id : null;
      this.captionState = on ? 'active' : 'off';
      this.usingOverlayCaptions = on && activation.delivery === 'overlay';
      this.renderer.setCues(this.usingOverlayCaptions ? activation.cues : []);
      setOverlayCaptionsClass(this.usingOverlayCaptions);
      if (on) this.renderer.update(displayMediaTime(this.video));
      this.recordCaptionTransition(on ? 'activated' : id ? 'activation-failed' : 'deactivated', {
        delivery: activation.delivery,
        cueCount: activation.cues.length,
        cueStart: activation.cues[0]?.start ?? null,
        cueEnd: activation.cues.at(-1)?.end ?? null,
        provider: selected?.source || null
      });
      this.persistAfterActivate(id, on, persist);
      this.updateCcState();
      this.renderCcMenu();
      this.onCaptionChange?.();
      if (!id) return 'off';
      return on ? 'on' : 'failed';
    } finally {
      this.activateInFlight = false;
      if (gen !== this.activateGeneration && !this.disposed) {
        void this.refresh();
      }
    }
  }

  async activate(id: string | null, options?: CaptionActivateOptions): Promise<CaptionToggleResult> {
    const result = await this.enqueue(() => this.activateUnlocked(id, options));
    this.emitCaptionHud(result, options?.hud);
    return result;
  }

  async toggleCaptions(): Promise<CaptionToggleResult> {
    return this.enqueue(async () => {
      if (this.disposed || this.tracks.length === 0) {
        this.emitCaptionHud('none', true);
        return 'none';
      }
      if (this.captionsAreOn()) {
        const result = await this.activateUnlocked(null);
        this.emitCaptionHud(result, true);
        return this.captionsAreOn() ? 'on' : 'off';
      }
      const match = pickCaptionTrack(this.tracks, this.lastLanguagePref || this.captionPreference);
      if (!match) {
        this.emitCaptionHud('none', true);
        return 'none';
      }
      const result = await this.activateUnlocked(match.id, { hud: true });
      this.emitCaptionHud(result, true);
      return this.captionsAreOn() ? 'on' : 'failed';
    });
  }

  updateTime(time: number): void {
    if (!this.usingOverlayCaptions) return;
    this.renderer.update(time);
    if (!this.adapter.refreshCaptionCues || !this.activeTrackId || this.captionCueRefreshInFlight) return;
    const now = Date.now();
    const seeked = Number.isFinite(this.lastCaptionCueTime) && Math.abs(time - this.lastCaptionCueTime) > 15;
    this.lastCaptionCueTime = time;
    if (!seeked && now - this.lastCaptionCueRefreshAt < 5000) return;
    this.lastCaptionCueRefreshAt = now;
    this.captionCueRefreshInFlight = true;
    const generation = this.activateGeneration;
    const trackId = this.activeTrackId;
    void this.adapter.refreshCaptionCues(trackId, time).then((result) => {
      if (!result || this.disposed || generation !== this.activateGeneration || trackId !== this.activeTrackId) return;
      if (result.status === 'active' && result.delivery === 'overlay') {
        this.renderer.setCues(result.cues);
        this.renderer.update(time);
        return;
      }
      this.activeTrackId = null;
      this.captionState = 'off';
      this.usingOverlayCaptions = false;
      this.renderer.setCues([]);
      setOverlayCaptionsClass(false);
      this.updateCcState();
      this.renderCcMenu();
      this.recordCaptionTransition('cue-refresh-failed', { time });
      this.emitCaptionHud('failed', true);
      this.onCaptionChange?.();
    }).catch((error) => {
      console.error('[Theater Everywhere] Caption cue refresh failed:', error);
    }).finally(() => {
      this.captionCueRefreshInFlight = false;
    });
  }

  retainCaptionsOnElementReset(): boolean {
    const pageId = this.adapter.mediaId?.() || null;
    return Boolean(pageId && this.mediaId && pageId === this.mediaId);
  }

  tooltipExtras(time: number): TooltipMediaExtras {
    const chapter = chapterAtTime(this.chapters, time);
    const preview = this.adapter.getPreviewFrame?.(time, this.video.duration || 0) || null;
    return {
      chapterTitle: chapter?.title || '',
      preview
    };
  }

  ccTooltip(): string {
    if (this.tracks.length === 0) return this.t('noSubtitlesAvailable');
    return this.captionsAreOn() ? this.t('disableSubtitles') : this.t('enableSubtitles');
  }

  dispose(): void {
    this.disposed = true;
    this.bumpEpoch();
    this.refreshQueued = false;
    setOverlayCaptionsClass(false);
    this.heatmapHasData = false;
    this.syncHeatmapPresence();
    this.renderer.dispose();
    this.adapter.dispose();
    this.chapterLayer.remove();
    this.heatmapLayer.remove();
  }
}
