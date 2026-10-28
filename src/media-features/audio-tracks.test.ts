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
    it('reports an accepted manual pick with the track as the refreshed list shows it', async () => {
      const { host, controller, results } = setup(null);
      host.offer(...dubbed);
      assert.equal(await controller.select('de'), true);
      assert.deepEqual(results, [{ result: 'selected', source: 'manual', track: { id: 'de', languageTag: 'de', label: 'de', kind: 'dub', selected: true }, index: 2 }]);
    });

    it('reports the saved preference once per item, and nothing when nothing changes', async () => {
      const { host, results } = setup('fr');
      host.offer(...dubbed);
      await flush();
      assert.deepEqual(results.map(item => item.result === 'selected' && [item.source, item.track.id, item.index]), [['preference', 'fr', 1]]);
      host.choose('de');
      await flush();
      assert.equal(results.length, 1, 'a host change after the decision stays silent');

      const quiet = setup('en');
      quiet.host.offer(...dubbed);
      await flush();
      assert.deepEqual(quiet.results, [], 'the preferred track was already playing');
      const unmatched = setup('ja');
      unmatched.host.offer(...dubbed);
      await flush();
      assert.deepEqual(unmatched.results, [], 'no match, the host keeps its choice');
    });

    it('reports a refused manual pick, but keeps a refused automatic one silent', async () => {
      const { host, controller, results } = setup('fr');
      host.autoSettle = false;
      host.offer(...dubbed);
      host.tracks = host.tracks.filter(track => track.id !== 'fr');
      host.settle();
      await flush();
      assert.deepEqual(results, [], 'the viewer did not ask for the automatic switch');

      host.autoSettle = true;
      host.blocked = true;
      host.notify();
      assert.equal(await controller.select('de'), false);
      assert.deepEqual(results, [{ result: 'failed', source: 'manual' }], 'a pick during an ad is refused and said so');
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
      assert.deepEqual(results.filter(item => item.source === 'manual'), [], 'the manual answer is stale');
      assert.equal(results.filter(item => item.source === 'preference').length, 1, 'only the later item\'s own automatic switch is reported');

      results.length = 0;
      host.mediaId = 'video-c';
      host.offer(...dubbed);
      controller.reset();
      host.settle();
      await flush();
      const disposing = controller.select('en');
      controller.dispose();
      host.settle();
      await disposing;
      assert.deepEqual(results, [], 'reset and dispose retire the pending answers');
    });
  });
});
