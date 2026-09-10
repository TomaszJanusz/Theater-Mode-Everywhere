import { CaptionRenderer } from './caption-renderer';
import { openCaptionOptionsDialog } from './caption-options-dialog';
import { chapterAtTime } from './cue-index';
import type { CaptionStyle } from './caption-style';
import { DEFAULT_CAPTION_STYLE } from './caption-style';
import { createMediaFeaturesAdapter } from './resolve-adapter';
import type { CaptionTrack, Chapter, MediaFeaturesAdapter, PreviewFrame } from './types';

export type MediaFeaturesBindings = {
  video: HTMLVideoElement;
  ccBtn: HTMLButtonElement;
  ccMenu: HTMLDivElement;
  scrubberTrack: HTMLElement;
  t: (key: string, substitutions?: string | string[]) => string;
  onCaptionChange?: () => void;
  onCaptionStyleChange?: (style: CaptionStyle) => void;
  decorateCaptionDialog?: (overlay: HTMLElement) => void;
};

export type TooltipMediaExtras = {
  chapterTitle: string;
  preview: PreviewFrame | null;
};

export class MediaFeaturesController {
  private adapter: MediaFeaturesAdapter;
  private renderer: CaptionRenderer;
  private video: HTMLVideoElement;
  private ccBtn: HTMLButtonElement;
  private ccMenu: HTMLDivElement;
  private chapterLayer: HTMLDivElement;
  private t: MediaFeaturesBindings['t'];
  private tracks: CaptionTrack[] = [];
  private chapters: Chapter[] = [];
  private activeTrackId: string | null = null;
  private usingOverlayCaptions = false;
  private disposed = false;
  private captionStyle: CaptionStyle = { ...DEFAULT_CAPTION_STYLE };
  private onCaptionChange?: () => void;
  private onCaptionStyleChange?: (style: CaptionStyle) => void;
  private decorateCaptionDialog?: (overlay: HTMLElement) => void;

  constructor(bindings: MediaFeaturesBindings) {
    this.adapter = createMediaFeaturesAdapter(bindings.video);
    this.renderer = new CaptionRenderer(bindings.onCaptionChange);
    this.video = bindings.video;
    this.ccBtn = bindings.ccBtn;
    this.ccMenu = bindings.ccMenu;
    this.t = bindings.t;
    this.onCaptionChange = bindings.onCaptionChange;
    this.onCaptionStyleChange = bindings.onCaptionStyleChange;
    this.decorateCaptionDialog = bindings.decorateCaptionDialog;
    this.chapterLayer = document.createElement('div');
    this.chapterLayer.className = 'theater-scrubber-chapters';
    bindings.scrubberTrack.appendChild(this.chapterLayer);
  }

  async start(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.disposed) return;
    try {
      this.tracks = await this.adapter.listCaptionTracks();
      this.chapters = this.adapter.getChapters ? await this.adapter.getChapters() : [];
    } catch (err) {
      console.error('[Theater Everywhere] Media features probe failed:', err);
      this.tracks = [];
      this.chapters = [];
    }
    this.renderChapterMarks();
    this.updateCcState();
    this.renderCcMenu();
  }

  private renderChapterMarks(): void {
    this.chapterLayer.replaceChildren();
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

  private updateCcState(): void {
    const hasTracks = this.tracks.length > 0;
    this.ccBtn.classList.toggle('disabled', !hasTracks);
    this.ccBtn.style.opacity = hasTracks ? '' : '0.35';
    this.ccBtn.style.pointerEvents = hasTracks ? '' : 'none';
    this.ccBtn.classList.toggle('active', this.activeTrackId !== null);
  }

  setCaptionStyle(style: CaptionStyle): void {
    this.captionStyle = style;
    this.renderer.setStyle(style);
  }

  renderCcMenu(): void {
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
    this.ccMenu.appendChild(header);

    if (this.tracks.length === 0) {
      const item = document.createElement('div');
      item.className = 'theater-cc-menu-item';
      item.textContent = this.t('noSubtitles');
      item.style.opacity = '0.5';
      item.style.cursor = 'default';
      this.ccMenu.appendChild(item);
      return;
    }

    this.ccMenu.appendChild(this.menuItem(this.t('subtitlesOff'), this.activeTrackId === null, () => {
      void this.activate(null);
    }));

    for (const track of this.tracks) {
      const baseLabel = track.label || track.language || this.t('trackLabel', '1');
      const label = track.autoGenerated && !/auto/i.test(baseLabel)
        ? this.t('autoGeneratedTrack', baseLabel)
        : baseLabel;
      this.ccMenu.appendChild(this.menuItem(label, this.activeTrackId === track.id, () => {
        void this.activate(track.id);
      }));
    }
  }

  private async openCaptionOptions(): Promise<void> {
    this.ccMenu.classList.remove('visible');
    this.onCaptionChange?.();
    await openCaptionOptionsDialog({
      t: this.t,
      style: this.captionStyle,
      onChange: (style) => {
        this.setCaptionStyle(style);
        this.onCaptionStyleChange?.(style);
      },
      decorate: this.decorateCaptionDialog
    });
  }

  private menuItem(label: string, active: boolean, onClick: () => void): HTMLButtonElement {
    const item = document.createElement('button');
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

  async activate(id: string | null): Promise<void> {
    this.activeTrackId = id;
    const overlayCues = await this.adapter.activateCaptionTrack(id);
    this.usingOverlayCaptions = Boolean(id && overlayCues && overlayCues.length > 0);
    this.renderer.setCues(this.usingOverlayCaptions ? overlayCues : []);
    document.documentElement.classList.toggle('theater-using-overlay-captions', this.usingOverlayCaptions);
    if (this.usingOverlayCaptions) this.renderer.update(this.video.currentTime || 0);
    this.updateCcState();
    this.renderCcMenu();
  }

  updateTime(time: number): void {
    if (this.usingOverlayCaptions) this.renderer.update(time);
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
    return this.activeTrackId ? this.t('disableSubtitles') : this.t('enableSubtitles');
  }

  dispose(): void {
    this.disposed = true;
    document.documentElement.classList.remove('theater-using-overlay-captions');
    this.renderer.dispose();
    this.adapter.dispose();
    this.chapterLayer.remove();
  }
}
