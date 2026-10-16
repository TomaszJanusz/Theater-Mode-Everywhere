import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { parseInline, parseMarkdown, safeLinkHref } from './markdown';

describe('markdown subset', () => {
  it('parses headings, joined paragraph lines and lists with continuation', () => {
    assert.deepEqual(parseMarkdown('# Title\n\nfirst\nsecond\n\n- a\n  more\n- **b**\n\n## Next'), [
      { type: 'heading', level: 1, children: [{ type: 'text', text: 'Title' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'first second' }] },
      { type: 'list', items: [
        [{ type: 'text', text: 'a more' }],
        [{ type: 'strong', children: [{ type: 'text', text: 'b' }] }]
      ] },
      { type: 'heading', level: 2, children: [{ type: 'text', text: 'Next' }] }
    ]);
  });

  it('nests emphasis, code and links', () => {
    assert.deepEqual(parseInline('**a *b* `c`** [x **y**](https://e.com/)'), [
      { type: 'strong', children: [
        { type: 'text', text: 'a ' }, { type: 'em', children: [{ type: 'text', text: 'b' }] },
        { type: 'text', text: ' ' }, { type: 'code', text: 'c' }
      ] },
      { type: 'text', text: ' ' },
      { type: 'link', href: 'https://e.com/', children: [{ type: 'text', text: 'x ' }, { type: 'strong', children: [{ type: 'text', text: 'y' }] }] }
    ]);
  });

  it('keeps unterminated markers literal', () => {
    assert.deepEqual(parseInline('a * b `c [d]'), [{ type: 'text', text: 'a * b `c [d]' }]);
  });

  it('never produces unsafe links or raw HTML', () => {
    for (const href of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x', '/relative', '//evil.com']) {
      assert.equal(safeLinkHref(href), null, href);
      assert.deepEqual(parseInline(`[click](${href})`), [{ type: 'text', text: 'click' }]);
    }
    assert.equal(safeLinkHref('mailto:a@b.dev'), 'mailto:a@b.dev');
    assert.deepEqual(parseInline('<script>alert(1)</script> <img src=x onerror=y>'), [{ type: 'text', text: '<script>alert(1)</script> <img src=x onerror=y>' }]);
    assert.deepEqual(parseInline('[<b>x</b>](https://e.com/" onclick="y)'), [{ type: 'link', href: 'https://e.com/%22%20onclick=%22y', children: [{ type: 'text', text: '<b>x</b>' }] }]);
  });

  it('handles the bundled policy without leaving markup characters behind', () => {
    const text = JSON.stringify(parseMarkdown(readFileSync(path.resolve(__dirname, '../PRIVACY.md'), 'utf8')));
    assert.ok(parseMarkdown(readFileSync(path.resolve(__dirname, '../PRIVACY.md'), 'utf8')).some(block => block.type === 'list'));
    assert.doesNotMatch(text, /\*\*|\]\(/);
  });
});
