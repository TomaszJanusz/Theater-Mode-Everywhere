import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MediaFeaturesController, type MediaFeaturesBindings } from './controller';
import type { CaptionCue, CaptionTrack, MediaFeaturesAdapter } from './types';
import type { CaptionLanguagePreference } from './caption-preference';

class TokenList {
  private tokens = new Set<string>();
  add(...tokens: string[]): void {
    for (const token of tokens) this.tokens.add(token);
  }
  remove(...tokens: string[]): void {
    for (const token of tokens) this.tokens.delete(token);
  }
  contains(token: string): boolean {
    return this.tokens.has(token);
  }
  toggle(token: string, force?: boolean): boolean {
    if (force === true) {
      this.tokens.add(token);
      return true;
    }
    if (force === false) {
      this.tokens.delete(token);
      return false;
    }
    if (this.tokens.has(token)) {
      this.tokens.delete(token);
      return false;
    }
    this.tokens.add(token);
    return true;
  }
}

const SAMPLE_CUES: CaptionCue[] = [{ start: 0, end: 2, text: 'Hello' }];
const SAMPLE_TRACK: CaptionTrack = {
  id: 'en',
  language: 'en',
  label: 'English',
  kind: 'captions',
  source: 'native-text-track'
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeButton(): HTMLButtonElement {
  return {
    classList: new TokenList(),
    style: {},
    className: 'theater-control-btn cc-btn'
  } as unknown as HTMLButtonElement;
}

function createController(adapter: Partial<MediaFeaturesAdapter> & Pick<MediaFeaturesAdapter, 'listCaptionTracks' | 'activateCaptionTrack'>, extras: Partial<MediaFeaturesBindings> = {}) {
  const ccBtn = extras.ccBtn || fakeButton();
  const noopRenderer = {
    setCues() {},
    update() {},
    setStyle() {},
    dispose() {}
  };
  const controller = new MediaFeaturesController({
    video: { currentTime: 0, duration: 100 } as HTMLVideoElement,
    ccBtn,
    ccMenu: { replaceChildren() {}, classList: new TokenList(), style: {} } as unknown as HTMLDivElement,
    scrubberTrack: { appendChild() { return null; } } as unknown as HTMLElement,
    t: (key) => key,
    renderer: noopRenderer,
    adapter: {
      probe: async () => ({ captions: true, chapters: false, previews: false }),
      getChapters: async () => [],
      dispose() {},
      ...adapter
    },
    ...extras,
    ccBtn
  });
  return { controller, ccBtn };
}

describe('MediaFeaturesController captions toggle', () => {
  it('waits for overlay cues before reporting on and lighting the CC icon', async () => {
    let activated = false;
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async (id) => {
        if (!id) return [];
        await delay(30);
        activated = true;
        return SAMPLE_CUES;
      }
    });
    await controller.refresh();
    const pending = controller.toggleCaptions();
    assert.equal(ccBtn.classList.contains('active'), false);
    const result = await pending;
    assert.equal(activated, true);
    assert.equal(result, 'on');
    assert.equal(ccBtn.classList.contains('active'), true);
    assert.equal(controller.ccTooltip(), 'disableSubtitles');
  });

  it('returns off and keeps the icon inactive when activate yields no cues', async () => {
    const persisted: CaptionLanguagePreference[] = [];
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async () => []
    }, {
      onCaptionPreferenceChange: (pref) => persisted.push(pref)
    });
    await controller.refresh();
    const result = await controller.toggleCaptions();
    assert.equal(result, 'off');
    assert.equal(ccBtn.classList.contains('active'), false);
    assert.equal(controller.ccTooltip(), 'enableSubtitles');
    assert.equal(persisted.some((pref) => pref.enabled), false);
  });

  it('serializes overlapping toggles so the last one wins', async () => {
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async (id) => {
        await delay(25);
        return id ? SAMPLE_CUES : [];
      }
    });
    await controller.refresh();
    const first = controller.toggleCaptions();
    const second = controller.toggleCaptions();
    const results = await Promise.all([first, second]);
    assert.deepEqual(results, ['on', 'off']);
    assert.equal(ccBtn.classList.contains('active'), false);
  });

  it('keeps HUD result aligned with the CC icon', async () => {
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async (id) => (id ? SAMPLE_CUES : [])
    });
    await controller.refresh();
    const result = await controller.toggleCaptions();
    assert.equal(result === 'on', ccBtn.classList.contains('active'));
    const off = await controller.toggleCaptions();
    assert.equal(off === 'on', ccBtn.classList.contains('active'));
    assert.equal(off, 'off');
  });

  it('does not deadlock when refresh runs during activate', async () => {
    let controller!: MediaFeaturesController;
    let ccBtn!: HTMLButtonElement;
    const created = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async (id) => {
        await controller.refresh();
        return id ? SAMPLE_CUES : [];
      }
    });
    controller = created.controller;
    ccBtn = created.ccBtn;
    await controller.refresh();
    const result = await Promise.race([
      controller.toggleCaptions(),
      delay(1000).then(() => {
        throw new Error('caption activate deadlocked on refresh');
      })
    ]);
    assert.equal(result, 'on');
    assert.equal(ccBtn.classList.contains('active'), true);
  });
});
