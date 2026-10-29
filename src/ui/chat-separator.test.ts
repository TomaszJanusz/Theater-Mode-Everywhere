import assert from 'node:assert/strict';
import { it } from 'node:test';

import { keyboardChatWidth } from './chat-separator';

const RANGE = { min: 280, max: 600 };

it('steps the chat width the way the arrows point, in larger steps with Shift, and jumps with Home and End', () => {
  assert.equal(keyboardChatWidth('ArrowLeft', false, 360, RANGE), 370);
  assert.equal(keyboardChatWidth('ArrowRight', false, 360, RANGE), 350);
  assert.equal(keyboardChatWidth('ArrowLeft', true, 360, RANGE), 410);
  assert.equal(keyboardChatWidth('ArrowRight', true, 360, RANGE), 310);
  assert.equal(keyboardChatWidth('Home', false, 360, RANGE), 280);
  assert.equal(keyboardChatWidth('End', true, 360, RANGE), 600);
  // Up, Down and Page keys stay with the page; the separator only moves sideways.
  for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Enter', 'a']) assert.equal(keyboardChatWidth(key, false, 360, RANGE), null);
});
