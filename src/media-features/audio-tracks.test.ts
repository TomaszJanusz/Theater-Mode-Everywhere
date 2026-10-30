import assert from 'node:assert/strict';
import { describe, it } from 'node:test';


import { AudioTrackController, type AudioTrackResult } from './audio-tracks';
import type { AudioTrack, AudioTrackList, MediaFeaturesAdapter } from './types';

/** A host whose list, selection and ad state the test drives, with selections settled by hand. */
class FakeHost {
  mediaId: string | null = 'video-a';
  blocked = false;
  tracks: AudioTrack[] = [];
  selections: Array<{ id: string; mediaId: string | null }> = [];
  observers = 0;
  autoSettle = true;
  private pending: Array<() => void> = [];
  private listeners = new Set<() => void>();

  offer(...ids: ReadonlyArray<readonly [string, string, AudioTrack['kind']]>): void {
    this.tracks = ids.map(([id, languageTag, kind], index) => ({ id, languageTag, label: id, kind, selected: index === 0 }));
    this.notify();
  }

  choose(id: string): void {
    this.tracks = this.tracks.map(track => ({ ...track, selected: track.id === id }));
    this.notify();
  }

  notify(): void { for (const listener of [...this.listeners]) listener(); }

  settle(): void { for (const run of this.pending.splice(0)) run(); }

  adapter(): MediaFeaturesAdapter {
    return {
      probe: async () => ({ captions: false, chapters: false, previews: false }),
      listCaptionTracks: async () => [],
      activateCaptionTrack: async () => ({ status: 'off', delivery: 'none', cues: [] }),
      dispose: () => {},
      listAudioTracks: (): AudioTrackList => ({ mediaId: this.mediaId, tracks: this.tracks, blocked: this.blocked }),
      selectAudioTrack: (id, mediaId) => {
        this.selections.push({ id, mediaId });
        return new Promise<boolean>(resolve => {
          const run = () => {
            const valid = mediaId === this.mediaId && this.tracks.some(track => track.id === id);
            if (valid) this.choose(id);
            resolve(valid);
          };
          if (this.autoSettle) queueMicrotask(run); else this.pending.push(run);
        });
      },
      observeAudioTracks: (onChange) => {
        this.observers += 1;
        this.listeners.add(onChange);
        return () => {
          if (this.listeners.delete(onChange)) this.observers -= 1;
        };
      }
    };
  }
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function setup(saved: string | null = 'fr') {
  const host = new FakeHost();
  let changes = 0;
  const preference = { saved };
  const savedPicks: string[] = [];
  const results: AudioTrackResult[] = [];
  const controller = new AudioTrackController({
    preference: () => preference.saved,
    onPreferenceChange: (value) => { savedPicks.push(value); },
    locales: () => ['en'],
    onChange: () => { changes += 1; },
    onResult: (result) => { results.push(result); }
  });
  controller.bind(host.adapter());
  return { host, controller, preference, savedPicks, results, changes: () => changes };
}

/** A result as ids: the track playing, and the refused one when there is a refusal. */
const ids = (result: AudioTrackResult) => [result.playing?.track.id ?? null, ...(result.refused === undefined ? [] : [result.refused?.track.id ?? null])];

const dubbed: Array<[string, string, AudioTrack['kind']]> = [['en', 'en-US', 'original'], ['fr', 'fr', 'dub'], ['de', 'de', 'dub']];

describe('audio track auto-apply', () => {
  it('applies a matching preference once, when tracks appear', async () => {
    const { host, controller } = setup();
    assert.equal(host.selections.length, 0);
    host.offer(...dubbed);
    await flush();
    assert.deepEqual(host.selections, [{ id: 'fr', mediaId: 'video-a' }]);
    assert.equal(controller.tracks().find(track => track.selected)?.id, 'fr');
    host.notify();
    await flush();
    assert.equal(host.selections.length, 1);
  });

  it('leaves the host choice when nothing matches, the match is selected, or the mode is host', async () => {
    for (const [choice, tracks] of [
      ['pl', dubbed],
      ['original', dubbed],
      [null, dubbed],
      ['fr', [['fr', 'fr', 'dub']]]
    ] as const) {
      const { host } = setup(choice);
      host.offer(...tracks);
      await flush();
      assert.equal(host.selections.length, 0, JSON.stringify(choice));
    }
  });

  it('a manual choice wins for the rest of the item', async () => {
    const { host, controller, preference } = setup(null);
    host.offer(...dubbed);
    assert.equal(await controller.select('de'), true);
    preference.saved = 'fr';
    host.notify();
    await flush();
    assert.deepEqual(host.selections.map(item => item.id), ['de']);
  });

  it('does not fight a host that restores its own choice', async () => {
    const { host } = setup();
    host.offer(...dubbed);
    await flush();
    host.choose('en');
    await flush();
    host.choose('en');
    await flush();
    assert.deepEqual(host.selections.map(item => item.id), ['fr']);
  });

  it('waits out ads, then applies to the content', async () => {
    const { host, controller } = setup();
    host.blocked = true;
    host.offer(...dubbed);
    await flush();
    assert.equal(host.selections.length, 0);
    assert.deepEqual(controller.tracks(), [], 'no menu during the ad');
    assert.equal(await controller.select('fr'), false, 'no selection reaches the host during the ad');
    host.blocked = false;
    host.notify();
    await flush();
    assert.deepEqual(host.selections.map(item => item.id), ['fr']);
  });

  it('evaluates each media item again, and keeps a decision across element resets of the same item', async () => {
    const { host, controller } = setup();
    host.offer(...dubbed);
    await flush();
    host.choose('en');
    controller.reset();
    await flush();
    assert.equal(host.selections.length, 1, 'same item after an element reset');
    host.mediaId = 'video-b';
    host.offer(...dubbed);
    await flush();
    assert.deepEqual(host.selections, [{ id: 'fr', mediaId: 'video-a' }, { id: 'fr', mediaId: 'video-b' }]);
  });

  it('rejects a selection result that arrives for an earlier item', async () => {
    const { host, controller, changes, savedPicks } = setup(null);
    host.offer(...dubbed);
    host.autoSettle = false;
    const pending = controller.select('de');
    host.mediaId = 'video-b';
    host.offer(...dubbed);
    const before = changes();
    host.settle();
    assert.equal(await pending, false);
    assert.equal(changes(), before, 'a stale result does not repaint');
    assert.equal(controller.tracks().find(track => track.selected)?.id, 'en');
    assert.deepEqual(savedPicks, [], 'a stale pick is not saved');
  });

  it('saves an accepted manual pick for the service, but never an automatic one', async () => {
    const { host, controller, savedPicks } = setup('fr');
    host.offer(...dubbed, ['ad', 'en', 'description']);
    await flush();
    assert.deepEqual(host.selections.map(item => item.id), ['fr']);
    assert.deepEqual(savedPicks, [], 'auto-apply does not rewrite the preference');
    assert.equal(await controller.select('de'), true);
    assert.equal(await controller.select('en'), true);
    assert.equal(await controller.select('ad'), true);
    assert.deepEqual(savedPicks, ['de', 'original'], 'description picks save nothing');
    host.blocked = true;
    host.notify();
    assert.equal(await controller.select('fr'), false);
    assert.deepEqual(savedPicks, ['de', 'original'], 'a refused pick saves nothing');
  });

  it('drops notifications from a replaced adapter and cleans up repeatably', async () => {
    const { host, controller } = setup();
    const replacement = new FakeHost();
    controller.bind(replacement.adapter());
    assert.equal(host.observers, 0);
    host.offer(...dubbed);
    await flush();
    assert.equal(host.selections.length, 0);
    controller.dispose();
    controller.dispose();
    assert.equal(replacement.observers, 0);
    replacement.offer(...dubbed);
    await flush();
    assert.equal(replacement.selections.length, 0);
  });

  describe('results for the viewer', () => {
    it('reports an accepted manual pick, named as the refreshed list shows it, including the track already playing', async () => {
      const { host, controller, results } = setup(null);
      host.offer(...dubbed);
      assert.equal(await controller.select('de'), true);
      assert.deepEqual(results, [{ playing: { track: { id: 'de', languageTag: 'de', label: 'de', kind: 'dub', selected: true }, index: 2 } }]);
      assert.equal(await controller.select('de'), true);
      assert.deepEqual(results.map(ids), [['de'], ['de']], 'picking what already plays is still answered');
    });

    it('reports the saved preference once per item, also when it was already playing, and nothing without a match', async () => {
      const { host, results } = setup('fr');
      host.offer(...dubbed);
      await flush();
      assert.deepEqual(results.map(ids), [['fr']]);
      host.choose('de');
      await flush();
      assert.equal(results.length, 1, 'a host change after the decision stays silent');

      const playing = setup('original');
      playing.host.offer(...dubbed);
      await flush();
      assert.deepEqual(playing.results.map(ids), [['en']], 'the original was already playing and is still named');
      assert.equal(playing.host.selections.length, 0, 'without switching anything');
      const unmatched = setup('ja');
      unmatched.host.offer(...dubbed);
      await flush();
      assert.deepEqual(unmatched.results, [], 'no match: the preference says nothing about this item');
      const none = setup(null);
      none.host.offer(...dubbed);
      await flush();
      assert.deepEqual(none.results, [], 'no preference: the player did not act');
    });

    it('reports a refused pick, manual or automatic, with the track that still plays', async () => {
      const { host, results } = setup('fr');
      host.autoSettle = false;
      host.offer(...dubbed);
      host.tracks = host.tracks.filter(track => track.id !== 'fr');
      host.settle();
      await flush();
      assert.deepEqual(results.map(ids), [['en', 'fr']], 'the saved language could not be applied');

      const manual = setup(null);
      manual.host.offer(...dubbed);
      manual.host.autoSettle = false;
      const pick = manual.controller.select('de');
      // The host drops the track before answering, so it answers no for this same item.
      manual.host.tracks = manual.host.tracks.filter(track => track.id !== 'de');
      manual.host.settle();
      assert.equal(await pick, false);
      assert.deepEqual(manual.results.map(ids), [['en', 'de']], 'a refused pick names what was asked for and what still plays');

      manual.results.length = 0;
      manual.host.autoSettle = true;
      manual.host.blocked = true;
      manual.host.notify();
      assert.equal(await manual.controller.select('en'), false);
      assert.deepEqual(manual.results.map(ids), [[null, null]], 'a pick during an ad is refused and said so');
    });

    it('reports and saves only the newest of overlapping picks, whatever the host answers to the earlier ones', async () => {
      const { host, controller, results, savedPicks } = setup(null);
      host.offer(...dubbed);
      host.autoSettle = false;
      const first = controller.select('de');
      const second = controller.select('fr');
      // A host that coalesces picks refuses the one it replaced, then applies the newer.
      host.tracks = host.tracks.filter(track => track.id !== 'de');
      host.settle();
      assert.equal(await first, false);
      assert.equal(await second, true);
      assert.deepEqual(results.map(ids), [['fr']], 'no refusal for the replaced pick');
      assert.deepEqual(savedPicks, ['fr']);

      results.length = 0;
      savedPicks.length = 0;
      host.offer(...dubbed);
      const earlier = controller.select('de');
      const later = controller.select('en');
      host.settle();
      await Promise.all([earlier, later]);
      assert.deepEqual(results.map(ids), [['en']], 'an earlier pick the host accepted is not announced either');
      assert.deepEqual(savedPicks, ['original']);
    });

    it('drops the saved preference\'s answer once the viewer picks during it', async () => {
      const { host, controller, results } = setup('fr');
      host.autoSettle = false;
      host.offer(...dubbed);
      assert.deepEqual(host.selections.map(selection => selection.id), ['fr']);
      const manual = controller.select('de');
      host.settle();
      assert.equal(await manual, true);
      await flush();
      assert.deepEqual(results.map(ids), [['de']]);
    });

    it('says nothing when the answer is for an earlier item, a reset list or a disposed controller', async () => {
      const { host, controller, results } = setup('fr');
      host.autoSettle = false;
      host.offer(...dubbed);
      const manual = controller.select('de');
      host.mediaId = 'video-b';
      host.offer(...dubbed);
      host.settle();
      await manual;
      await flush();
      assert.equal(results.length, 1, 'only the later item\'s own automatic switch is reported');
      assert.deepEqual(results.map(ids), [['fr']]);

      results.length = 0;
      host.mediaId = 'video-c';
      host.offer(...dubbed);
      controller.reset();
      host.settle();
      await flush();
      assert.deepEqual(results, [], 'reset retires the pending automatic answer');
      const disposing = controller.select('en');
      controller.dispose();
      host.settle();
      await disposing;
      assert.deepEqual(results, [], 'dispose retires the pending answer');
    });
  });
});

describe('retained audio knowledge', () => {
  it('shows stale tracks without selecting, reporting or restarting title evaluation', async () => {
    const host = new FakeHost();
    host.offer(...dubbed);
    const adapter = host.adapter();
    let list: AudioTrackList = { mediaId: 'video-a', tracks: host.tracks, blocked: false, bindingId: 'one' };
    adapter.listAudioTracks = () => list;
    const reports: AudioTrackResult[] = [];
    const controller = new AudioTrackController({ preference: () => 'en-US', locales: () => ['en'], onChange() {}, onResult: result => reports.push(result) });
    controller.bind(adapter);
    assert.equal(reports.length, 1);
    list = { ...list, blocked: true, stale: true, tracks: list.tracks.map(track => ({ ...track, selected: false, disabled: true })) };
    host.notify();
    assert.equal(controller.tracks().length, 3);
    assert.equal(await controller.select('fr'), false);
    assert.deepEqual(host.selections, []);
    assert.equal(reports.length, 1);
    list = { mediaId: 'video-a', tracks: host.tracks, blocked: false, bindingId: 'two' };
    host.notify();
    assert.equal(reports.length, 1, 'revalidation is not a new title or automatic preference decision');
    controller.dispose();
  });

  it('retires a result for an old command binding even when the title is unchanged', async () => {
    const host = new FakeHost();
    host.offer(...dubbed);
    host.autoSettle = false;
    const adapter = host.adapter();
    let bindingId = 'one';
    adapter.listAudioTracks = () => ({ mediaId: host.mediaId, tracks: host.tracks, blocked: false, bindingId });
    const reports: AudioTrackResult[] = [];
    const saves: string[] = [];
    const controller = new AudioTrackController({ preference: () => null, locales: () => ['en'], onChange() {},
      onResult: result => reports.push(result), onPreferenceChange: value => saves.push(value) });
    controller.bind(adapter);
    const pending = controller.select('fr');
    bindingId = 'two'; host.notify(); host.settle();
    assert.equal(await pending, false);
    assert.deepEqual(reports, []);
    assert.deepEqual(saves, []);
    controller.dispose();
  });
});
