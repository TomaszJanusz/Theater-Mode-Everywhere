import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

const root = path.resolve(__dirname, '..');

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'test-utils') return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sources(file)
      : /\.(?:[cm]?js|ts)$/.test(file) && !/\.test\./.test(file) ? [file] : [];
  });
}

it('shipped source and the bundled brand dependency never assign HTML or insert HTML strings', () => {
  const violations: string[] = [];
  const files = ['src', 'options', 'popup', 'node_modules/@privacy-thing/brand/dist']
    .flatMap(directory => sources(path.join(root, directory)));
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    // Cover dot/bracket access and compound assignments without a parser dependency.
    const sinks = /(?:\.\s*(?:innerHTML|outerHTML)|\[\s*['"](?:innerHTML|outerHTML)['"]\s*\])\s*(?:[+?&|]{0,2}=)(?!=)|(?:\.\s*insertAdjacentHTML|\[\s*['"]insertAdjacentHTML['"]\s*\])\s*\(|\bdocument\s*\.\s*write(?:ln)?\s*\(/g;
    for (const match of source.matchAll(sinks)) {
      violations.push(`${path.relative(root, file)}:${source.slice(0, match.index).split('\n').length}`);
    }
  }
  assert.deepEqual(violations, [], 'Build DOM nodes or render plain text instead of HTML strings');
});
