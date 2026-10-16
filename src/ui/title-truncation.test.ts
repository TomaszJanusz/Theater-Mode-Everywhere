import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { splitTitleForTruncation, type TitleSegment } from './title-truncation';

const text = (parts: readonly TitleSegment[]) => parts.map(part => part.text).join('');

describe('title truncation', () => {
  it('keeps the end of a long title from a word boundary and loses no text', () => {
    const title = 'The Extraordinarily Long Documentary About Mountains, Part 12 - Summit Day';
    const { head, tail } = splitTitleForTruncation([{ text: title }]);
    assert.equal(text(head) + text(tail), title);
    assert.ok(text(tail).startsWith(' ') && text(tail).length <= 29);
    assert.ok(text(tail).endsWith('Summit Day'));
  });
  it('does not split a short title', () => {
    assert.deepEqual(splitTitleForTruncation([{ text: 'Short title' }]).tail, []);
  });
  it('preserves segment styling across the cut', () => {
    const segments: TitleSegment[] = [
      { text: 'A series with a rather long name', className: 'title' },
      { text: ' • ', className: 'separator' },
      { text: 'Episode 5: The one where it is long', className: 'subtitle' }
    ];
    const { head, tail } = splitTitleForTruncation(segments);
    assert.equal(text(head) + text(tail), text(segments));
    assert.deepEqual([...head, ...tail].filter(part => part.className === 'separator').length, 1);
    assert.ok(tail.every(part => part.className === 'subtitle'));
  });
  it('cuts unspaced text without breaking a surrogate pair', () => {
    const title = '日本語のとても長い題名'.repeat(4) + '😀'.repeat(14);
    const { head, tail } = splitTitleForTruncation([{ text: title }]);
    assert.equal(text(head) + text(tail), title);
    assert.ok(!/[\uD800-\uDBFF]$/.test(text(head)));
    assert.ok(!/^[\uDC00-\uDFFF]/.test(text(tail)));
  });
});
