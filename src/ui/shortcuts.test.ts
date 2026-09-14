import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchesShortcut } from './shortcuts';

function key(partial: {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
}): KeyboardEvent {
  return {
    key: partial.key,
    code: partial.code || '',
    ctrlKey: Boolean(partial.ctrlKey),
    altKey: Boolean(partial.altKey),
    shiftKey: Boolean(partial.shiftKey),
    metaKey: Boolean(partial.metaKey)
  } as KeyboardEvent;
}

describe('shortcut matching', () => {
  it('matches a standalone plus key', () => {
    assert.equal(matchesShortcut(key({ key: '+', shiftKey: true, code: 'Equal' }), '+'), true);
  });

  it('matches Ctrl++ without dropping the plus', () => {
    assert.equal(
      matchesShortcut(key({ key: '+', ctrlKey: true, shiftKey: true, code: 'Equal' }), 'Ctrl++'),
      true
    );
  });

  it('still matches Shift+T', () => {
    assert.equal(matchesShortcut(key({ key: 't', shiftKey: true, code: 'KeyT' }), 'Shift+T'), true);
  });
});
