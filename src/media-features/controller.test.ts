import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MediaFeaturesController, type MediaFeaturesBindings } from './controller';
import type { CaptionActivationResult, CaptionCue, CaptionTrack, MediaFeaturesAdapter } from './types';
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

describe('provider caption layout lifecycle', () => {
  it('uses the provider contract and disconnects/rejects old notifications on rebind and exit', async () => {
    const calls: string[] = [];
    const callbacks: Array<() => void> = [];
    const makeAdapter = (name: string, height: number): MediaFeaturesAdapter => ({
      probe: async () => ({ captions: false, chapters: false, previews: false }),
      listCaptionTracks: async () => [],
      activateCaptionTrack: async () => ({status:'off', delivery:'none', cues:[]}),
      readHostCaptionLayout: () => ({ width: 200, height, rows: 2 }),
      observeHostCaptionLayout: callback => {
        callbacks.push(callback);
        calls.push(`observe:${name}`);
        return () => calls.push(`disconnect:${name}`);
      },
      dispose: () => { calls.push(`dispose:${name}`); }
    });
    let changes = 0;
    const { controller } = createController(makeAdapter('first', 60), {onCaptionChange:()=>changes++});
    assert.equal(controller.readHostCaptionLayout()?.height, 60);
    callbacks[0]();
    assert.equal(changes, 1);
    controller.rebindAdapter(makeAdapter('second', 90));
    const before = changes;
    callbacks[0]();
    assert.equal(changes, before, 'old provider notifications are ignored');
    callbacks[1]();
    assert.equal(changes, before + 1);
    assert.equal(controller.readHostCaptionLayout()?.height, 90);
    assert.deepEqual(calls.slice(0, 4), ['observe:first', 'disconnect:first', 'dispose:first', 'observe:second']);
    controller.dispose();
    const disposed = changes;
    callbacks[1]();
    assert.equal(changes, disposed);
    assert.equal(controller.readHostCaptionLayout(), null);
    assert.deepEqual(calls.slice(-2), ['disconnect:second', 'dispose:second']);
    await delay(0);
  });
});

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

type TestAdapter = Omit<Partial<MediaFeaturesAdapter>, 'activateCaptionTrack'>
  & Pick<MediaFeaturesAdapter, 'listCaptionTracks'>
  & { activateCaptionTrack(id: string | null): Promise<CaptionActivationResult | CaptionCue[] | null> };

function createController(adapter: TestAdapter, extras: Partial<MediaFeaturesBindings> = {}) {
  const ccBtn = extras.ccBtn || fakeButton();
  const noopRenderer = {
    setCues() {},
    update() {},
    setStyle() {},
    setMaxLines() { return false; },
    dispose() {}
  };
  const activateCaptionTrack = adapter.activateCaptionTrack;
  const normalizedAdapter: MediaFeaturesAdapter = {
    probe: async () => ({ captions: true, chapters: false, previews: false }),
    getChapters: async () => [],
    dispose() {},
    ...adapter,
    async activateCaptionTrack(id) {
      const result = await activateCaptionTrack(id);
      if (result && !Array.isArray(result)) return result;
      if (id === null) return { status: 'off', delivery: 'none', cues: [] };
      const tracks = await adapter.listCaptionTracks();
      const track = tracks.find((item) => item.id === id);
      if (track?.delivery === 'host') return { status: 'active', delivery: 'host', cues: [] };
      return result && result.length > 0
        ? { status: 'active', delivery: 'overlay', cues: result }
        : { status: 'failed', delivery: 'none', cues: [] };
    }
  };
  const controller = new MediaFeaturesController({
    video: { currentTime: 0, duration: 100 } as HTMLVideoElement,
    ccMenu: { replaceChildren() {}, classList: new TokenList(), style: {} } as unknown as HTMLDivElement,
    scrubberTrack: { appendChild() { return null; } } as unknown as HTMLElement,
    t: (key) => key,
    renderer: noopRenderer,
    adapter: normalizedAdapter,
    ...extras,
    ccBtn
  });
  return { controller, ccBtn };
}

describe('MediaFeaturesController chapter context', () => {
  it('withholds previous episode windows during refresh, mismatch and disposal', async () => {
    let mediaId = 'ogv:one';
    let holdReload = false;
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = [{ start: 1, end: 5, title: 'Intro', source: 'bilibiliIntl', confidence: 'high' as const }];
    const second = [{ ...first[0], start: 10, end: 20 }];
    const { controller } = createController({
      listCaptionTracks: async () => [],
      activateCaptionTrack: async () => [],
      mediaId: () => mediaId,
      getChapters: async () => mediaId === 'ogv:one' ? first : second,
      reload: async () => { if (holdReload) await gate; }
    });
    assert.equal(controller.chapterContext(), null);
    await controller.refresh();
    assert.deepEqual(controller.chapterContext(), { mediaId: 'ogv:one', chapters: first });
    holdReload = true;
    const pending = controller.refresh();
    assert.equal(controller.chapterContext(), null, 'refresh must withhold even a matching old media id');
    mediaId = 'ogv:two';
    assert.equal(controller.chapterContext(), null);
    release();
    await pending;
    assert.deepEqual(controller.chapterContext(), { mediaId: 'ogv:two', chapters: second });
    mediaId = 'ogv:three';
    assert.equal(controller.chapterContext(), null, 'an adapter change must invalidate unrefreshed windows');
    mediaId = 'ogv:two';
    assert.deepEqual(controller.chapterContext(), { mediaId: 'ogv:two', chapters: second });
    controller.dispose();
    assert.equal(controller.chapterContext(), null);
  });
});

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
    assert.deepEqual(hud, ['loading', 'failed']);
  });

  it('moves the picture only when subtitles are actually on', async () => {
    const layout: boolean[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const second: CaptionTrack = { ...SAMPLE_TRACK, id: 'pl', language: 'pl', label: 'Polish' };
    const { controller } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK, second],
      activateCaptionTrack: async (id) => {
        if (id === 'en') await gate;
        return id ? SAMPLE_CUES : [];
      }
    }, {
      onSubtitleLayoutChange: (on) => layout.push(on)
    });
    await controller.refresh();
    const pending = controller.activate('en');
    await delay(20);
    assert.deepEqual(layout, []);
    release();
    assert.equal(await pending, 'on');
    assert.deepEqual(layout, [true]);
    await controller.activate('pl');
    assert.deepEqual(layout, [true]);
    assert.equal(await controller.activate(null), 'off');
    assert.deepEqual(layout, [true, false]);
  });

  it('clears the subtitle layout when the controller is disposed', async () => {
    const layout: boolean[] = [];
    const { controller } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async (id) => (id ? SAMPLE_CUES : [])
    }, {
      onSubtitleLayoutChange: (on) => layout.push(on)
    });
    await controller.refresh();
    assert.equal(await controller.activate('en'), 'on');
    controller.dispose();
    assert.deepEqual(layout, [true, false]);
  });

  it('turns host-managed captions on without overlay cues', async () => {
    const hostTrack: CaptionTrack = {
      id: 'twitch:host-cc',
      language: 'en',
      label: 'Closed Captions',
      kind: 'captions',
      source: 'twitch',
      delivery: 'host'
    };
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => [hostTrack],
      activateCaptionTrack: async (id) => (id ? [] : null)
    });
    await controller.refresh();
    const result = await controller.toggleCaptions();
    assert.equal(result, 'on');
    assert.equal(ccBtn.classList.contains('active'), true);
    assert.equal(ccBtn.classList.contains('disabled'), false);
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

  it('emits loading HUD while a caption track is fetching', async () => {
    const hud: Array<{ result: string; label?: string }> = [];
    const { controller } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async (id) => {
        await delay(20);
        return id ? SAMPLE_CUES : [];
      }
    }, {
      onCaptionHud: (payload) => hud.push(payload),
      t: (key, substitutions) => (key === 'autoGeneratedTrack' ? `${substitutions} (auto)` : key)
    });
    await controller.refresh();
    const pending = controller.toggleCaptions();
    await delay(0);
    assert.deepEqual(hud, [{ result: 'loading' }]);
    const result = await pending;
    assert.equal(result, 'on');
    assert.deepEqual(hud, [{ result: 'loading' }, { result: 'on', label: 'English' }]);
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
    assert.deepEqual(hud, [{ result: 'loading' }, { result: 'on', label: 'English' }]);
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
      activateCaptionTrack: async (id) => id
        ? { status: 'active', delivery: 'overlay', cues: SAMPLE_CUES }
        : { status: 'off', delivery: 'none', cues: [] },
      mediaId: () => 'same-title'
    });
    await controller.refresh();
    await controller.activate(SAMPLE_TRACK.id);
    assert.equal(ccBtn.classList.contains('active'), true);
    assert.equal(controller.retainCaptionsOnElementReset(), true);
  });

  it('turns captions off when the selected track disappears on refresh', async () => {
    let tracks: CaptionTrack[] = [SAMPLE_TRACK];
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => tracks,
      activateCaptionTrack: async (id) => (id ? SAMPLE_CUES : []),
      mediaId: () => 'same-title'
    });
    await controller.refresh();
    await controller.activate(SAMPLE_TRACK.id);
    tracks = [];
    await controller.refresh();
    assert.equal(ccBtn.classList.contains('active'), false);
  });

  it('invalidates an active track when media identity changes to null', async () => {
    let mediaId: string | null = 'movie-one';
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => mediaId ? [SAMPLE_TRACK] : [],
      activateCaptionTrack: async (id) => (id ? SAMPLE_CUES : []),
      mediaId: () => mediaId
    });
    await controller.refresh();
    await controller.activate(SAMPLE_TRACK.id);
    mediaId = null;
    await controller.refresh();
    assert.equal(ccBtn.classList.contains('active'), false);
  });

  it('rejects a completed activation from the previous media generation', async () => {
    let mediaId = 'movie-one';
    let finishActivation!: () => void;
    const activationGate = new Promise<void>((resolve) => { finishActivation = resolve; });
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async (id) => {
        if (!id) return [];
        await activationGate;
        return SAMPLE_CUES;
      },
      mediaId: () => mediaId
    });
    await controller.refresh();
    const pending = controller.activate(SAMPLE_TRACK.id);
    await delay(0);
    mediaId = 'movie-two';
    await controller.refresh();
    finishActivation();
    assert.equal(await pending, 'off');
    assert.equal(ccBtn.classList.contains('active'), false);
  });

  it('keeps CC active during a normal gap between overlay cues', async () => {
    const updates: number[] = [];
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async (id) => (id ? SAMPLE_CUES : [])
    }, {
      renderer: {
        setCues() {},
        update: (time) => updates.push(time),
        setStyle() {},
        setMaxLines() { return false; },
        dispose() {}
      }
    });
    await controller.refresh();
    await controller.activate(SAMPLE_TRACK.id);
    controller.updateTime(10);
    assert.equal(ccBtn.classList.contains('active'), true);
    assert.ok(updates.includes(10));
  });

  it('turns CC off when a dynamic cue window cannot be refreshed', async () => {
    const hud: string[] = [];
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async (id) => (id ? SAMPLE_CUES : []),
      refreshCaptionCues: async () => ({ status: 'failed', delivery: 'none', cues: [] })
    }, {
      onCaptionHud: (payload) => hud.push(payload.result)
    });
    await controller.refresh();
    await controller.activate(SAMPLE_TRACK.id);
    controller.updateTime(50);
    await delay(0);
    assert.equal(ccBtn.classList.contains('active'), false);
    assert.ok(hud.includes('failed'));
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
      activateCaptionTrack: async (id) => id
        ? { status: 'active', delivery: 'overlay', cues: SAMPLE_CUES }
        : { status: 'off', delivery: 'none', cues: [] },
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

  it('publishes a typed media snapshot after refresh', async () => {
    const seen: Array<{ captions: boolean; errorCount: number }> = [];
    const { controller } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async (id) => (id ? SAMPLE_CUES : [])
    }, {
      onSnapshot: (snapshot) => {
        seen.push({ captions: snapshot.capabilities.captions, errorCount: snapshot.errors.length });
      }
    });
    await controller.refresh();
    assert.deepEqual(seen, [{ captions: true, errorCount: 0 }]);
  });

  it('publishes the adapter title without duplicates and clears it on invalidate', async () => {
    const titles: Array<string | null> = [];
    const { controller } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async (id) => (id ? SAMPLE_CUES : []),
      getTitle: () => '  Night Drive  '
    }, {
      onTitle: (title) => {
        titles.push(title);
      }
    });
    await controller.refresh();
    controller.invalidate();
    assert.deepEqual(titles, ['Night Drive', null]);
  });

  it('publishes available and reloaded titles before caption discovery completes', async () => {
    const titles: Array<string | null> = [];
    let title = 'Available title';
    let finishReload!: () => void;
    let finishTracks!: (tracks: CaptionTrack[]) => void;
    let tracksStarted!: () => void;
    const reloadGate = new Promise<void>((resolve) => { finishReload = resolve; });
    const tracksGate = new Promise<CaptionTrack[]>((resolve) => { finishTracks = resolve; });
    const discovered = new Promise<void>((resolve) => { tracksStarted = resolve; });
    const { controller } = createController({
      getTitle: () => title,
      reload: async () => {
        await reloadGate;
        title = 'Reloaded title';
      },
      listCaptionTracks: () => {
        tracksStarted();
        return tracksGate;
      },
      activateCaptionTrack: async () => []
    }, { onTitle: (value) => titles.push(value) });

    const pending = controller.refresh();
    assert.deepEqual(titles, ['Available title']);
    finishReload();
    await discovered;
    assert.deepEqual(titles, ['Available title', 'Reloaded title']);
    finishTracks([]);
    await pending;
    assert.deepEqual(titles, ['Available title', 'Reloaded title']);
    controller.dispose();
  });

  it('publishes the title while restoring saved captions is still pending', async () => {
    const titles: Array<string | null> = [];
    let finishActivation!: (result: CaptionActivationResult) => void;
    let activationStarted!: () => void;
    const activationGate = new Promise<CaptionActivationResult>((resolve) => { finishActivation = resolve; });
    const started = new Promise<void>((resolve) => { activationStarted = resolve; });
    const { controller } = createController({
      getTitle: () => 'Night Drive',
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async (id) => {
        if (!id) return [];
        activationStarted();
        return activationGate;
      }
    }, {
      captionPreference: { enabled: true, language: 'en', autoGenerated: false },
      onTitle: (value) => titles.push(value)
    });

    const pending = controller.refresh();
    await started;
    assert.deepEqual(titles, ['Night Drive']);
    finishActivation({ status: 'active', delivery: 'overlay', cues: SAMPLE_CUES });
    await pending;
    assert.deepEqual(titles, ['Night Drive']);
    controller.dispose();
  });

  it('does not publish a title from a reload invalidated by an adapter change', async () => {
    const titles: Array<string | null> = [];
    let finishReload!: () => void;
    let title: string | null = null;
    const gate = new Promise<void>((resolve) => { finishReload = resolve; });
    const { controller } = createController({
      getTitle: () => title,
      reload: async () => { await gate; title = 'Stale title'; },
      listCaptionTracks: async () => [],
      activateCaptionTrack: async () => []
    }, { onTitle: (value) => titles.push(value) });
    const pending = controller.refresh();
    controller.rebindAdapter({
      getTitle: () => 'Current title',
      probe: async () => ({ captions: false, chapters: false, previews: false }),
      listCaptionTracks: async () => [],
      activateCaptionTrack: async () => ({ status: 'off', delivery: 'none', cues: [] }),
      dispose() {}
    });
    finishReload();
    await pending;
    assert.equal(titles.includes('Stale title'), false);
    assert.equal(titles.at(-1), 'Current title');
    controller.dispose();
  });

  it('accepts a heatmap from the adapter without breaking caption refresh', async () => {
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async (id) => (id ? SAMPLE_CUES : []),
      getHeatmap: () => ({
        source: 'markers',
        svgPath: 'M 0 96 C 250 20 750 20 1000 96 L 1000 100 L 0 100 Z'
      })
    });
    await controller.refresh();
    assert.equal(ccBtn.classList.contains('disabled'), false);
  });

  it('records a provider error on the snapshot when probe fails', async () => {
    const codes: string[] = [];
    const { controller } = createController({
      listCaptionTracks: async () => {
        throw new Error('probe failed');
      },
      activateCaptionTrack: async () => []
    }, {
      onSnapshot: (snapshot) => {
        codes.push(...snapshot.errors.map((error) => error.code));
      }
    });
    await controller.refresh();
    assert.deepEqual(codes, ['network-failed']);
  });
});
