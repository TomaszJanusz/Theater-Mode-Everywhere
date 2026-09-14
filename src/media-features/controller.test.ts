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

  it('returns failed and keeps the icon inactive when activate yields no cues', async () => {
    const persisted: CaptionLanguagePreference[] = [];
    const hud: string[] = [];
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async () => []
    }, {
      onCaptionPreferenceChange: (pref) => persisted.push(pref),
      onCaptionHud: (payload) => hud.push(payload.result)
    });
    await controller.refresh();
    const result = await controller.toggleCaptions();
    assert.equal(result, 'failed');
    assert.equal(ccBtn.classList.contains('active'), false);
    assert.equal(controller.ccTooltip(), 'enableSubtitles');
    assert.equal(persisted.some((pref) => pref.enabled), false);
    assert.deepEqual(hud, ['failed']);
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

  it('reports HUD on menu activate and names the track', async () => {
    const hud: Array<{ result: string; label?: string }> = [];
    const { controller } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async (id) => (id ? SAMPLE_CUES : [])
    }, {
      onCaptionHud: (payload) => hud.push(payload),
      t: (key, substitutions) => (key === 'autoGeneratedTrack' ? `${substitutions} (auto)` : key)
    });
    await controller.refresh();
    const result = await controller.activate(SAMPLE_TRACK.id, { hud: true });
    assert.equal(result, 'on');
    assert.deepEqual(hud, [{ result: 'on', label: 'English' }]);
    hud.length = 0;
    const off = await controller.activate(null, { hud: true });
    assert.equal(off, 'off');
    assert.deepEqual(hud, [{ result: 'off' }]);
  });

  it('restores a remembered language with HUD only when captions actually turn on', async () => {
    const hud: string[] = [];
    const unlabeled = {
      id: 'native:0',
      language: '',
      label: 'English',
      kind: 'subtitles' as const,
      source: 'native-text-track' as const
    };
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => [unlabeled],
      activateCaptionTrack: async (id) => (id ? SAMPLE_CUES : [])
    }, {
      captionPreference: { enabled: true, language: '', autoGenerated: false, label: 'english' },
      onCaptionHud: (payload) => hud.push(payload.result)
    });
    await controller.refresh();
    assert.equal(ccBtn.classList.contains('active'), true);
    assert.deepEqual(hud, ['on']);
  });

  it('does not HUD when auto-restore cannot load cues', async () => {
    const hud: string[] = [];
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async () => []
    }, {
      captionPreference: { enabled: true, language: 'en', autoGenerated: false },
      onCaptionHud: (payload) => hud.push(payload.result)
    });
    await controller.refresh();
    assert.equal(ccBtn.classList.contains('active'), false);
    assert.deepEqual(hud, []);
  });

  it('autoloads the first track when captions were left on but the language is missing', async () => {
    const polish = {
      id: 'pl',
      language: 'pl',
      label: 'Polish',
      kind: 'subtitles' as const,
      source: 'youtube' as const
    };
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => [polish],
      activateCaptionTrack: async (id) => (id ? SAMPLE_CUES : [])
    }, {
      captionPreference: { enabled: true, language: 'en', autoGenerated: true }
    });
    await controller.refresh();
    assert.equal(ccBtn.classList.contains('active'), true);
  });

  it('does not autoload captions when they were left off', async () => {
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async (id) => (id ? SAMPLE_CUES : [])
    }, {
      captionPreference: { enabled: false, language: 'en', autoGenerated: false }
    });
    await controller.refresh();
    assert.equal(ccBtn.classList.contains('active'), false);
  });

  it('persists a label when the track has no language code', async () => {
    const persisted: CaptionLanguagePreference[] = [];
    const unlabeled = {
      id: 'native:0',
      language: '',
      label: 'English',
      kind: 'subtitles' as const,
      source: 'native-text-track' as const
    };
    const { controller } = createController({
      listCaptionTracks: async () => [unlabeled],
      activateCaptionTrack: async (id) => (id ? SAMPLE_CUES : [])
    }, {
      onCaptionPreferenceChange: (pref) => persisted.push(pref)
    });
    await controller.refresh();
    await controller.activate(unlabeled.id);
    assert.equal(persisted.at(-1)?.enabled, true);
    assert.equal(persisted.at(-1)?.language, '');
    assert.equal(persisted.at(-1)?.label, 'english');
  });

  it('keeps overlay captions when the media element empties on the same title', async () => {
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async (id) => (id ? SAMPLE_CUES : []),
      mediaId: () => 'same-title'
    });
    await controller.refresh();
    await controller.activate(SAMPLE_TRACK.id);
    assert.equal(ccBtn.classList.contains('active'), true);
    assert.equal(controller.retainCaptionsOnElementReset(), true);
  });

  it('F-03 does not let a stale refresh retry list captions after adapter rebind', async () => {
    const calls: string[] = [];
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => {
        calls.push('stale-list');
        return [];
      },
      activateCaptionTrack: async () => [],
      dispose() {
        calls.push('stale-dispose');
      }
    }, {
      captionPreference: { enabled: true, language: 'en', autoGenerated: false }
    });
    const pending = controller.refresh();
    await delay(20);
    controller.rebindAdapter({
      probe: async () => ({ captions: true, chapters: false, previews: false }),
      listCaptionTracks: async () => {
        calls.push('fresh-list');
        return [SAMPLE_TRACK];
      },
      activateCaptionTrack: async (id) => (id ? SAMPLE_CUES : []),
      getChapters: async () => [],
      dispose() {
        calls.push('fresh-dispose');
      }
    });
    await pending;
    await delay(800);
    assert.equal(calls.filter((item) => item === 'stale-list').length, 1);
    assert.ok(calls.includes('fresh-list'));
    assert.equal(ccBtn.classList.contains('disabled'), false);
  });
});
