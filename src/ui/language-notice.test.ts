import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { manualClock } from '../../.storybook/manual-clock';

import {
  LANGUAGE_AFTER_UPDATE_MS, LANGUAGE_MIN_VISIBLE_MS, LANGUAGE_LOAD_DELAY_MS, LanguageNotice, languageNoticeText,
  type LanguageLine, type LanguageLines, type LanguageSource
} from './language-notice';

const FADE_MS = 200;
const on = (detail: string): LanguageLine => ({ kind: 'status', title: 'Subtitles on', detail });
const track = (detail: string): LanguageLine => ({ kind: 'status', title: 'Audio track', detail });
const loading: LanguageLine = { kind: 'loading', title: 'Loading subtitles...' };

/** The notice with a view that records what a plate would show, on a clock the test advances. */
function setup() {
  const clock = manualClock();
  const session = { element: {} as object | null, epoch: 1 };
  const plate = { lines: null as LanguageLines | null, fading: false, plates: 0, renders: [] as Array<LanguageSource[]> };
  const notice = new LanguageNotice(clock, {
    render(lines, changed) {
      if (!plate.lines) plate.plates += 1;
      plate.lines = lines;
      plate.fading = false;
      plate.renders.push([...changed]);
    },
    fadeOut() { plate.fading = true; },
    remove() { plate.lines = null; plate.fading = false; }
  }, () => session.element ? { element: session.element, epoch: session.epoch } : null, FADE_MS);
  const shown = () => plate.lines?.map(([source, line]) => [source, line.kind === 'status' ? line.detail ?? line.title : 'spinner']) ?? null;
  return { clock, session, plate, notice, shown };
}

describe('language notice', () => {
  it('merges subtitles and audio into one plate in a fixed order, whichever arrives first', () => {
    const { notice, plate, shown } = setup();
    notice.update({ audio: track('Français') });
    notice.update({ subtitles: on('English') });
    assert.deepEqual(shown(), [['subtitles', 'English'], ['audio', 'Français']]);
    assert.equal(plate.plates, 1);
    assert.deepEqual(plate.renders, [['audio'], ['subtitles']], 'each update repaints only its own line');
    notice.update({ subtitles: null });
    assert.deepEqual(shown(), [['audio', 'Français']], 'withdrawing subtitles leaves the audio line');
  });

  it('stays 4 s from when it can first be read and 2 s after its last update', () => {
    for (const [updateAt, hideAt] of [[1000, LANGUAGE_MIN_VISIBLE_MS], [3500, 3500 + LANGUAGE_AFTER_UPDATE_MS]]) {
      const { clock, notice, plate } = setup();
      notice.update({ subtitles: on('English') });
      clock.advance(updateAt);
      notice.update({ audio: track('Français') });
      clock.advance(hideAt - updateAt - 1);
      assert.equal(plate.fading, false, `update at ${updateAt}: still readable at ${hideAt - 1}`);
      clock.advance(1);
      assert.equal(plate.fading, true, `update at ${updateAt}: fades at ${hideAt}`);
      clock.advance(FADE_MS);
      assert.equal(plate.lines, null);
      assert.equal(clock.pending, 0, 'one hide timer, nothing left behind');
    }
  });

  it('starts a fresh notice for an update that arrives while the plate fades', () => {
    const { clock, notice, plate, shown } = setup();
    notice.update({ subtitles: on('English') });
    clock.advance(LANGUAGE_MIN_VISIBLE_MS + 100);
    assert.equal(plate.fading, true);
    notice.update({ audio: track('Français') });
    assert.equal(plate.fading, false);
    assert.deepEqual(shown(), [['audio', 'Français']], 'the new line is shown, never lost; the expired one had its time');
    assert.equal(plate.plates, 2);
    clock.advance(LANGUAGE_MIN_VISIBLE_MS - 1);
    assert.equal(plate.fading, false, 'the fresh notice gets the full minimum');
    clock.advance(1);
    assert.equal(plate.fading, true);
  });

  it('keeps the plate while a spinner turns and counts the minimum from when it resolves', () => {
    const { clock, notice, plate, shown } = setup();
    notice.update({ subtitles: loading });
    clock.advance(LANGUAGE_LOAD_DELAY_MS - 1);
    assert.equal(plate.lines, null, 'a fast download never flashes');
    clock.advance(1);
    notice.update({ audio: track('Français') });
    assert.deepEqual(shown(), [['subtitles', 'spinner'], ['audio', 'Français']]);
    notice.update({ subtitles: loading });
    assert.deepEqual(plate.renders, [['subtitles'], ['audio']], 'a repeated loading leaves the turning spinner alone');
    clock.advance(60_000);
    assert.equal(plate.fading, false, 'the audio line waits with the spinner');
    notice.update({ subtitles: on('English') });
    assert.deepEqual(shown(), [['subtitles', 'English'], ['audio', 'Français']]);
    assert.equal(plate.plates, 1);
    clock.advance(LANGUAGE_MIN_VISIBLE_MS - 1);
    assert.equal(plate.fading, false);
    clock.advance(1);
    assert.equal(plate.fading, true);
  });

  it('restarts the minimum when a spinner that joined a readable plate resolves', () => {
    const { clock, notice, plate } = setup();
    notice.update({ audio: track('Français') });
    notice.update({ subtitles: loading });
    clock.advance(LANGUAGE_LOAD_DELAY_MS);
    clock.advance(10_000);
    notice.update({ subtitles: on('English') });
    clock.advance(LANGUAGE_MIN_VISIBLE_MS - 1);
    assert.equal(plate.fading, false, 'the resolved label gets the full minimum, not just the time after an update');
    clock.advance(1);
    assert.equal(plate.fading, true);
  });

  it('withdraws an old subtitles result when a new load starts, without touching audio', () => {
    const { clock, notice, shown } = setup();
    notice.update({ subtitles: on('English'), audio: track('Français') });
    notice.update({ subtitles: loading });
    assert.deepEqual(shown(), [['audio', 'Français']]);
    clock.advance(100);
    notice.update({ subtitles: on('Deutsch') });
    clock.advance(LANGUAGE_LOAD_DELAY_MS);
    assert.deepEqual(shown(), [['subtitles', 'Deutsch'], ['audio', 'Français']], 'the result cancels the pending spinner');
  });

  it('names the load that supersedes a turning spinner, and reads each load aloud', () => {
    const { clock, notice, plate, shown } = setup();
    const named = (detail: string): LanguageLine => ({ kind: 'loading', title: 'Subtitles', detail, announce: `Loading subtitles: ${detail}` });
    notice.update({ subtitles: named('Polish') });
    clock.advance(LANGUAGE_LOAD_DELAY_MS);
    assert.equal(languageNoticeText(plate.lines!), 'Loading subtitles: Polish');
    notice.update({ subtitles: named('Polish') });
    assert.deepEqual(plate.renders, [['subtitles']], 'the same load repeated leaves the spinner alone');
    notice.update({ subtitles: named('German') });
    assert.deepEqual(plate.renders, [['subtitles'], ['subtitles']]);
    assert.deepEqual(plate.lines!.map(([, line]) => line.detail), ['German'], 'a superseded pick never keeps its language on screen');
    assert.equal(languageNoticeText(plate.lines!), 'Loading subtitles: German');
    notice.update({ subtitles: on('German') });
    assert.deepEqual(shown(), [['subtitles', 'German']]);
    assert.equal(languageNoticeText(plate.lines!), 'Subtitles on: German');
  });

  it('shows only the latest pick when a load is superseded before its spinner appears', () => {
    const { clock, notice, plate } = setup();
    notice.update({ subtitles: { kind: 'loading', title: 'Subtitles', detail: 'Polish' } });
    clock.advance(LANGUAGE_LOAD_DELAY_MS - 1);
    notice.update({ subtitles: { kind: 'loading', title: 'Subtitles', detail: 'German' } });
    clock.advance(LANGUAGE_LOAD_DELAY_MS - 1);
    assert.equal(plate.lines, null);
    clock.advance(1);
    assert.deepEqual(plate.lines!.map(([, line]) => line.detail), ['German']);
  });

  it('ignores work for another session and leaves nothing after clear', () => {
    const { clock, session, notice, plate, shown } = setup();
    notice.update({ subtitles: loading });
    session.epoch += 1;
    clock.advance(LANGUAGE_LOAD_DELAY_MS);
    assert.equal(plate.lines, null, 'a stale loader never shows');

    notice.update({ audio: track('Français') });
    session.element = {};
    clock.advance(10_000);
    assert.equal(plate.fading, false, 'a stale plate is not faded for the new session');
    notice.update({ subtitles: on('English') });
    assert.deepEqual(shown(), [['subtitles', 'English']], 'the new session starts from an empty notice');

    notice.update({ subtitles: loading, audio: track('Français') });
    notice.clear();
    notice.clear();
    assert.equal(plate.lines, null);
    assert.equal(clock.pending, 0);
    session.element = null;
    notice.update({ audio: track('Français') });
    assert.equal(plate.lines, null, 'nothing shows outside a session');
    assert.equal(clock.pending, 0);
  });

  it('reads the merged text once', () => {
    assert.equal(languageNoticeText([['subtitles', on('English')], ['audio', track('Français')], ['audioRefused', { kind: 'status', title: "Couldn't switch audio track" }]]),
      "Subtitles on: English. Audio track: Français. Couldn't switch audio track");
  });
});
