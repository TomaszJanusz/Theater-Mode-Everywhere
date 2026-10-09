import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MediaFeaturesController, type MediaFeaturesBindings } from './controller';
import { CompositeMediaAdapter } from './composite-adapter';
import type { CaptionActivationResult, CaptionCue, CaptionTrack, Chapter, MediaFeaturesAdapter } from './types';
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
    await flushTasks();
  });
});

/** Lets queued promise chains finish before inspecting fire-and-forget controller work. */
function flushTasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Holds a provider result until a test has inspected loading or cancellation state.
 * @returns A pending promise and the resolver that releases its supplied result.
 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

/**
 * Provides in-memory CC classes and attributes for controller tests without a DOM.
 * @returns A button stub whose aria-busy and selection state can be inspected.
 */
function fakeButton(): HTMLButtonElement {
  const attributes = new Map<string, string>();
  return {
    classList: new TokenList(),
    setAttribute(name: string, value: string) { attributes.set(name, value); },
    getAttribute(name: string) { return attributes.get(name) ?? null; },
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
  it('keeps Bilibili episode actions when native chapters take timeline precedence', async () => {
    let mediaId = 'ogv:one';
    const native: Chapter[] = [{ start: 0, end: 100, title: 'Native chapter', source: 'native-text-track', confidence: 'high' }];
    let windows: Chapter[] = [
      { start: 1, end: 5, title: 'Intro', source: 'bilibiliIntl', confidence: 'high' },
      { start: 90, end: 100, title: 'Outro', source: 'bilibiliIntl', confidence: 'high' }
    ];
    const stub = (overrides: Partial<MediaFeaturesAdapter>): MediaFeaturesAdapter => ({
      probe: async () => ({ captions: false, chapters: true, previews: false }),
      listCaptionTracks: async () => [],
      activateCaptionTrack: async () => ({ status: 'off', delivery: 'none', cues: [] }),
      dispose() {},
      ...overrides
    });
    const composite = new CompositeMediaAdapter([
      stub({ getChapters: async () => native }),
      stub({ getChapters: async () => { throw new Error('unavailable chapter source'); } }),
      stub({ getChapters: async () => windows, mediaId: () => mediaId })
    ]);
    let timeline: readonly Chapter[] = [];
    const { controller } = createController(composite, {
      adapter: composite,
      onSnapshot: snapshot => { timeline = snapshot.chapters; }
    });
    await controller.refresh();
    assert.deepEqual(timeline, native, 'native timeline preference is preserved');
    assert.deepEqual(controller.chapterContext(), { mediaId: 'ogv:one', chapters: windows });
    assert.equal(controller.tooltipExtras(2).chapterTitle, 'Native chapter');

    mediaId = 'ogv:two';
    assert.equal(controller.chapterContext(), null, 'old episode windows cannot escape the id gate');
    windows = [{ ...windows[0], start: 10, end: 20 }];
    await controller.refresh();
    assert.deepEqual(controller.chapterContext(), { mediaId: 'ogv:two', chapters: windows });
    assert.deepEqual(timeline, native);
    windows = [];
    await controller.refresh();
    assert.deepEqual(controller.chapterContext(), { mediaId: 'ogv:two', chapters: [] }, 'missing provider windows must not fall back to native chapters');
    controller.dispose();
    assert.equal(controller.chapterContext(), null);
  });

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

describe('shared caption loading lifecycle', () => {
  for (const source of ['activation', 'toggle', 'restore'] as const) {
    it(`publishes the spinner and busy icon before ${source} starts its request`, async () => {
      const gate = deferred<CaptionCue[]>();
      const started = deferred<void>();
      const hud: string[] = [];
      const { controller, ccBtn } = createController({
        listCaptionTracks: async () => [SAMPLE_TRACK],
        activateCaptionTrack: async (id) => {
          if (!id) return [];
          assert.deepEqual(hud, ['loading']);
          assert.equal(ccBtn.classList.contains('loading'), true);
          assert.equal(ccBtn.getAttribute('aria-busy'), 'true');
          started.resolve();
          return gate.promise;
        }
      }, {
        ...(source === 'restore' ? { captionPreference: { enabled: true, language: 'en', autoGenerated: false } } : {}),
        onCaptionHud: payload => hud.push(payload.result)
      });
      if (source !== 'restore') await controller.refresh();
      const pending = source === 'restore' ? controller.start()
        : source === 'toggle' ? controller.toggleCaptions() : controller.activate('en');
      await started.promise;
      assert.deepEqual(hud, ['loading']);
      gate.resolve(SAMPLE_CUES);
      await pending;
      assert.deepEqual(hud, ['loading', 'on']);
      assert.equal(ccBtn.classList.contains('loading'), false);
      assert.equal(ccBtn.classList.contains('active'), true);
      assert.equal(ccBtn.getAttribute('aria-busy'), 'false');
      controller.dispose();
    });
  }

  for (const cancellation of ['invalidate', 'dispose', 'rebind', 'media-change'] as const) {
    it(`dismisses loading immediately on ${cancellation} and ignores the late result`, async () => {
      const gate = deferred<CaptionCue[]>();
      const started = deferred<void>();
      let mediaId = 'movie-one';
      const hud: string[] = [];
      const { controller, ccBtn } = createController({
        listCaptionTracks: async () => [SAMPLE_TRACK],
        mediaId: () => mediaId,
        activateCaptionTrack: async id => {
          if (!id) return [];
          started.resolve();
          return gate.promise;
        }
      }, { onCaptionHud: payload => hud.push(payload.result) });
      await controller.refresh();
      const pending = controller.activate('en');
      await started.promise;
      if (cancellation === 'media-change') {
        mediaId = 'movie-two';
        await controller.refresh();
      } else if (cancellation === 'rebind') {
        controller.rebindAdapter({
          probe: async () => ({ captions: false, chapters: false, previews: false }),
          listCaptionTracks: async () => [],
          activateCaptionTrack: async () => ({ status: 'off', delivery: 'none', cues: [] }),
          dispose() {}
        });
      } else controller[cancellation]();
      assert.deepEqual(hud, ['loading', 'dismiss']);
      assert.equal(ccBtn.classList.contains('loading'), false);
      assert.equal(ccBtn.getAttribute('aria-busy'), 'false');
      gate.resolve(SAMPLE_CUES);
      assert.equal(await pending, 'off');
      assert.deepEqual(hud, ['loading', 'dismiss']);
      assert.equal(ccBtn.classList.contains('active'), false);
      controller.dispose();
    });
  }

  it('does not run queued caption selections after an epoch change', async () => {
    const gate = deferred<CaptionCue[]>();
    const calls: Array<string | null> = [];
    const hud: string[] = [];
    const { controller } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK, { ...SAMPLE_TRACK, id: 'pl' }],
      activateCaptionTrack: async id => {
        calls.push(id);
        return id ? gate.promise : [];
      }
    }, { onCaptionHud: payload => hud.push(payload.result) });
    await controller.refresh();
    const first = controller.activate('en');
    await flushTasks();
    const queued = controller.activate('pl');
    controller.invalidate();
    gate.resolve(SAMPLE_CUES);
    await Promise.all([first, queued]);
    assert.deepEqual(calls, ['en', null]);
    assert.deepEqual(hud, ['loading', 'dismiss']);
    controller.dispose();
  });

  it('restores host captions once after a successful activation', async () => {
    const calls: Array<string | null> = [];
    const hud: string[] = [];
    const { controller } = createController({
      listCaptionTracks: async () => [{ ...SAMPLE_TRACK, delivery: 'host' }],
      activateCaptionTrack: async id => {
        calls.push(id);
        return id ? { status: 'active', delivery: 'host', cues: [] } : [];
      }
    }, {
      captionPreference: { enabled: true, language: 'en', autoGenerated: false },
      onCaptionHud: payload => hud.push(payload.result)
    });
    await controller.start();
    assert.deepEqual(calls, ['en']);
    assert.deepEqual(hud, ['loading', 'on']);
    controller.dispose();
  });

  it('does not restore the previous language after a failed manual selection and metadata events', async () => {
    const calls: Array<string | null> = [];
    const hud: string[] = [];
    const { controller } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK, { ...SAMPLE_TRACK, id: 'pl', language: 'pl' }],
      activateCaptionTrack: async id => {
        calls.push(id);
        return id === 'en' ? SAMPLE_CUES : [];
      }
    }, {
      captionPreference: { enabled: true, language: 'en', autoGenerated: false },
      onCaptionHud: payload => hud.push(payload.result)
    });
    await controller.start();
    calls.length = 0;
    hud.length = 0;
    assert.equal(await controller.activate('pl'), 'failed');
    await controller.refresh();
    await controller.refresh();
    assert.deepEqual(calls, ['pl', null]);
    assert.deepEqual(hud, ['loading', 'failed']);
    controller.dispose();
  });

  it('cancels a delayed restoration retry when the user makes a newer selection', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const calls: Array<string | null> = [];
    const hud: string[] = [];
    const { controller } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK, { ...SAMPLE_TRACK, id: 'pl', language: 'pl' }],
      activateCaptionTrack: async id => { calls.push(id); return []; }
    }, {
      captionPreference: { enabled: true, language: 'en', autoGenerated: false },
      onCaptionHud: payload => hud.push(payload.result)
    });
    const restoring = controller.start();
    await flushTasks();
    assert.deepEqual(hud, ['loading', 'failed']);
    assert.equal(await controller.activate('pl'), 'failed');
    t.mock.timers.tick(700);
    await restoring;
    assert.deepEqual(calls, ['en', null, 'pl', null]);
    assert.deepEqual(hud, ['loading', 'failed', 'loading', 'failed']);
    controller.dispose();
  });

  it('keeps captions and layout during a cue-window request and dismisses its spinner on success', async () => {
    const gate = deferred<CaptionActivationResult>();
    const hud: string[] = [];
    const layout: boolean[] = [];
    const persisted: CaptionLanguagePreference[] = [];
    const rendered: CaptionCue[][] = [];
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async id => id ? SAMPLE_CUES : [],
      prepareCaptionCueRefresh: () => () => {
        assert.deepEqual(hud, ['loading']);
        assert.equal(ccBtn.classList.contains('loading'), true);
        return gate.promise;
      }
    }, {
      onCaptionHud: payload => hud.push(payload.result),
      onSubtitleLayoutChange: on => layout.push(on),
      onCaptionPreferenceChange: preference => persisted.push(preference),
      renderer: { setCues: cues => rendered.push(cues || []), update() {}, setStyle() {}, setMaxLines: () => false, dispose() {} }
    });
    await controller.refresh();
    await controller.activate('en');
    hud.length = 0;
    controller.updateTime(50);
    await flushTasks();
    assert.deepEqual(hud, ['loading']);
    assert.deepEqual(rendered.at(-1), SAMPLE_CUES);
    assert.deepEqual(layout, [true]);
    const cues = [{ start: 50, end: 52, text: 'Next window' }];
    gate.resolve({ status: 'active', delivery: 'overlay', cues });
    await flushTasks();
    assert.deepEqual(rendered.at(-1), cues);
    assert.deepEqual(hud, ['loading', 'dismiss']);
    assert.equal(ccBtn.classList.contains('loading'), false);
    assert.equal(ccBtn.classList.contains('active'), true);
    assert.deepEqual(layout, [true]);
    assert.equal(persisted.length, 1);
    controller.dispose();
  });

  it('does not flash loading UI when a cue-window check needs no request', async () => {
    const hud: string[] = [];
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async id => id ? SAMPLE_CUES : [],
      prepareCaptionCueRefresh: () => null
    }, { onCaptionHud: payload => hud.push(payload.result) });
    await controller.refresh();
    await controller.activate('en');
    hud.length = 0;
    controller.updateTime(50);
    await flushTasks();
    assert.deepEqual(hud, []);
    assert.equal(ccBtn.classList.contains('loading'), false);
    assert.equal(ccBtn.classList.contains('active'), true);
    controller.dispose();
  });

  for (const phase of ['activation', 'refresh', 'refresh-preparation'] as const) {
    it(`finishes the loading UI with a failure when ${phase} throws`, async () => {
      const hud: string[] = [];
      const { controller, ccBtn } = createController({
        listCaptionTracks: async () => [SAMPLE_TRACK],
        activateCaptionTrack: async id => {
          if (!id) return [];
          if (phase === 'activation') throw new Error('network failure');
          return SAMPLE_CUES;
        },
        prepareCaptionCueRefresh: () => {
          if (phase === 'refresh-preparation') throw new Error('preparation failure');
          return async () => { throw new Error('network failure'); };
        }
      }, { onCaptionHud: payload => hud.push(payload.result) });
      await controller.refresh();
      if (phase === 'activation') await controller.activate('en');
      else {
        await controller.activate('en');
        hud.length = 0;
        controller.updateTime(50);
        await flushTasks();
      }
      assert.deepEqual(hud, ['loading', 'failed']);
      assert.equal(ccBtn.classList.contains('loading'), false);
      assert.equal(ccBtn.classList.contains('active'), false);
      assert.equal(ccBtn.getAttribute('aria-busy'), 'false');
      controller.dispose();
    });
  }
});

describe('MediaFeaturesController captions toggle', () => {
  it('waits for overlay cues before reporting on and lighting the CC icon', async () => {
    let activated = false;
    const entered = deferred<void>();
    const cues = deferred<CaptionCue[]>();
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async (id) => {
        if (!id) return [];
        entered.resolve(undefined);
        const result = await cues.promise;
        activated = true;
        return result;
      }
    });
    await controller.refresh();
    const pending = controller.toggleCaptions();
    await entered.promise;
    assert.equal(ccBtn.classList.contains('active'), false);
    cues.resolve(SAMPLE_CUES);
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
    const entered = deferred<void>();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const second: CaptionTrack = { ...SAMPLE_TRACK, id: 'pl', language: 'pl', label: 'Polish' };
    const { controller } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK, second],
      activateCaptionTrack: async (id) => {
        if (id === 'en') {
          entered.resolve(undefined);
          await gate;
        }
        return id ? SAMPLE_CUES : [];
      }
    }, {
      onSubtitleLayoutChange: (on) => layout.push(on)
    });
    await controller.refresh();
    const pending = controller.activate('en');
    await entered.promise;
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
    const on = deferred<CaptionCue[]>();
    const off = deferred<CaptionCue[]>();
    const enteredOn = deferred<void>();
    const enteredOff = deferred<void>();
    const calls: Array<string | null> = [];
    const { controller, ccBtn } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async (id) => {
        calls.push(id);
        if (id) {
          enteredOn.resolve(undefined);
          return on.promise;
        }
        enteredOff.resolve(undefined);
        return off.promise;
      }
    });
    await controller.refresh();
    const first = controller.toggleCaptions();
    const second = controller.toggleCaptions();
    await enteredOn.promise;
    assert.deepEqual(calls, ['en']);
    on.resolve(SAMPLE_CUES);
    await first;
    await enteredOff.promise;
    assert.deepEqual(calls, ['en', null]);
    off.resolve([]);
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

  it('does not deadlock when refresh runs during activate', { timeout: 1000 }, async () => {
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
    const result = await controller.toggleCaptions();
    assert.equal(result, 'on');
    assert.equal(ccBtn.classList.contains('active'), true);
  });

  it('emits loading HUD while a caption track is fetching', async () => {
    const entered = deferred<void>();
    const cues = deferred<CaptionCue[]>();
    const hud: Array<{ result: string; label?: string }> = [];
    const { controller } = createController({
      listCaptionTracks: async () => [SAMPLE_TRACK],
      activateCaptionTrack: async (id) => {
        if (!id) return [];
        entered.resolve(undefined);
        return cues.promise;
      }
    }, {
      onCaptionHud: (payload) => hud.push(payload),
      t: (key, substitutions) => (key === 'autoGeneratedTrack' ? `${substitutions} (auto)` : key)
    });
    await controller.refresh();
    const pending = controller.toggleCaptions();
    await entered.promise;
    assert.deepEqual(hud, [{ result: 'loading' }]);
    cues.resolve(SAMPLE_CUES);
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
    const result = await controller.activate(SAMPLE_TRACK.id);
    assert.equal(result, 'on');
    assert.deepEqual(hud, [{ result: 'loading' }, { result: 'on', label: 'English' }]);
    hud.length = 0;
    const off = await controller.activate(null);
    assert.equal(off, 'off');
    assert.deepEqual(hud, [{ result: 'off' }]);
  });

  it('restores a remembered language through the loading HUD', async () => {
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
    assert.deepEqual(hud, ['loading', 'on']);
  });

  it('reports loading and failure for every auto-restore attempt', async () => {
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
    assert.deepEqual(hud, ['loading', 'failed', 'loading', 'failed']);
    await controller.refresh();
    assert.deepEqual(hud, ['loading', 'failed', 'loading', 'failed'], 'metadata refresh cannot start another retry loop');
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
    await flushTasks();
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
      prepareCaptionCueRefresh: () => async () => ({ status: 'failed', delivery: 'none', cues: [] })
    }, {
      onCaptionHud: (payload) => hud.push(payload.result)
    });
    await controller.refresh();
    await controller.activate(SAMPLE_TRACK.id);
    controller.updateTime(50);
    await flushTasks();
    assert.equal(ccBtn.classList.contains('active'), false);
    assert.ok(hud.includes('failed'));
  });

  it('F-03 does not let a stale refresh retry list captions after adapter rebind', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
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
    await flushTasks();
    assert.deepEqual(calls, ['stale-list']);
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
    t.mock.timers.tick(700);
    await pending;
    t.mock.timers.tick(800);
    await flushTasks();
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
