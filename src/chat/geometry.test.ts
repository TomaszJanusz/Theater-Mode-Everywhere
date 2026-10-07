import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHAT_DOCK_BREAKPOINT_PX,
  DEFAULT_CHAT_WIDTH_PX,
  MAX_CHAT_WIDTH_PX,
  MIN_CHAT_WIDTH_PX,
  bottomChatHeight,
  chatGeometry,
  clampChatWidth
} from './geometry';

describe('chat geometry', () => {
  it('clamps the shared width range', () => {
    assert.equal(MIN_CHAT_WIDTH_PX, 280);
    assert.equal(MAX_CHAT_WIDTH_PX, 600);
    assert.equal(DEFAULT_CHAT_WIDTH_PX, 360);
    assert.equal(clampChatWidth(10), 280);
    assert.equal(clampChatWidth(900), 600);
    assert.equal(clampChatWidth(Number.NaN), 360);
    assert.equal(clampChatWidth(360.4), 360);
  });

  it('docks to the right at 900px and to the bottom below that', () => {
    const right = chatGeometry({ viewportWidth: 900, viewportHeight: 800, preferredWidth: 360, mode: 'shown' });
    assert.equal(right.dock, 'right');
    assert.equal(CHAT_DOCK_BREAKPOINT_PX, 900);
    assert.equal(right.videoWidth, '540px');
    assert.equal(right.videoHeight, '800px');
    assert.equal(right.chatWidth, '360px');
    assert.equal(right.chatHeight, '800px');
    assert.equal(right.chatLeft, '540px');
    assert.equal(right.chatTop, '0px');

    const bottom = chatGeometry({ viewportWidth: 899, viewportHeight: 800, preferredWidth: 360, mode: 'shown' });
    assert.equal(bottom.dock, 'bottom');
    assert.equal(bottom.videoWidth, '899px');
    assert.equal(bottom.chatWidth, '899px');
    assert.equal(bottom.chatHeight, `${bottomChatHeight(800)}px`);
    assert.equal(bottom.videoHeight, `${800 - bottomChatHeight(800)}px`);
    assert.equal(bottom.chatTop, bottom.videoHeight);
    assert.equal(bottom.chatLeft, '0px');
    assert.equal(bottom.width, 360);
  });

  it('gives a hidden chat its docked box and the picture the full viewport', () => {
    const hidden = chatGeometry({ viewportWidth: 1280, viewportHeight: 800, preferredWidth: 360, mode: 'hidden' });
    assert.equal(hidden.videoWidth, '1280px');
    assert.equal(hidden.videoHeight, '800px');
    assert.equal(hidden.chatWidth, '360px');
    assert.equal(hidden.chatHeight, '800px');
    assert.equal(hidden.chatLeft, '920px');
    assert.equal(hidden.chatTop, '0px');
  });

  it('uses full-viewport fallbacks when the viewport is unknown and zeroes an absent chat', () => {
    const shown = chatGeometry({ viewportWidth: 0, viewportHeight: 0, preferredWidth: 360, mode: 'shown' });
    assert.equal(shown.dock, 'right');
    assert.equal(shown.videoWidth, 'calc(100vw - 360px)');
    assert.equal(shown.videoHeight, '100vh');
    assert.equal(shown.chatWidth, '360px');
    assert.equal(shown.chatHeight, '100vh');
    assert.equal(shown.chatLeft, 'calc(100vw - 360px)');

    const absent = chatGeometry({ viewportWidth: 0, viewportHeight: 0, preferredWidth: 360, mode: 'absent' });
    assert.equal(absent.videoWidth, '100vw');
    assert.equal(absent.videoHeight, '100vh');
    assert.equal(absent.chatWidth, '0px');
    assert.equal(absent.chatHeight, '0px');

    const measuredAbsent = chatGeometry({ viewportWidth: 1280, viewportHeight: 800, preferredWidth: 360, mode: 'absent' });
    assert.equal(measuredAbsent.videoWidth, '1280px');
    assert.equal(measuredAbsent.videoHeight, '800px');
    assert.equal(measuredAbsent.chatWidth, '0px');
  });

  it('keeps a short bottom panel from consuming the whole picture', () => {
    assert.equal(bottomChatHeight(800), 360);
    assert.equal(bottomChatHeight(400), 160);
    assert.equal(bottomChatHeight(300), 120);
    assert.equal(bottomChatHeight(0), 360);
  });
});
