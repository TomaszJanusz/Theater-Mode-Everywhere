import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Merges CHANGELOG.md when `main` is merged into `dev` (.github/workflows/sync-dev.yml).
//
// A release on main inserts `## [X.Y.Z]` right below `## [Unreleased]` and moves
// main's pending entries under it. A line merge cannot place that heading: git
// either conflicts or, with other merge drivers, files dev's whole Unreleased
// section under the new release. So the file is rebuilt as sections instead:
//
// - The text above `## [Unreleased]` and the released sections are main's, plus
//   dev's own edits to them. Main may only add release sections on top; if it
//   changed an existing one, or dev already has a heading main added, give up.
// - Unreleased entries merge as sets, three-way: an entry main added is added,
//   an entry main removed (released, usually) is removed from dev too when dev
//   still has it word for word, and everything else of dev's stays where it is.
//
// The result is built only when main added no Unreleased entries; folding those
// into dev's subsections takes judgement. Otherwise git's own clean merge is
// accepted only if it holds exactly the expected sections and entries. Anything else returns a
// reason and the sync falls back to its conflict issue: nothing is dropped silently.

const SECTION = /^(?=## \[)/m;
const UNRELEASED = '## [Unreleased]';
const CONFLICT_MARKER = /^(?:<{7}|\|{7}|={7}|>{7})(?: |$)/m;

function parseChangelog(text) {
  const [preamble, ...sections] = text.split(SECTION);
  const headings = sections.map(section => section.split('\n', 1)[0].trimEnd());
  if (headings[0] !== UNRELEASED || headings.lastIndexOf(UNRELEASED) !== 0) return null;
  return {
    preamble: preamble.trimEnd(),
    unreleased: sections[0].trimEnd(),
    released: sections.slice(1).map((section, index) => ({ heading: headings[index + 1], text: section.trimEnd() })),
  };
}

// Entries of the Unreleased section as `subsection\ntext` keys: a bullet with its
// continuation lines, filed under the `### ` heading above it.
function unreleasedEntries(section) {
  const entries = [];
  let subsection = '';
  let entry = null;
  section.split('\n').slice(1).forEach((line, index) => {
    if (line.startsWith('### ')) {
      subsection = line.trimEnd();
      entry = null;
    } else if (line.trim() === '') {
      entry = null;
    } else if (entry && !line.startsWith('- ')) {
      entry.lines.push(line);
    } else {
      entry = { subsection, lines: [line], start: index + 1 };
      entries.push(entry);
    }
  });
  return entries.map(({ subsection, lines, start }) => ({
    key: `${subsection}\n${lines.join('\n')}`,
    start,
    end: start + lines.length,
  }));
}

function render(preamble, unreleased, released) {
  return [preamble, unreleased, ...released.map(section => section.text)].filter(Boolean).join('\n\n') + '\n';
}

function sameSections(a, b) {
  return a.length === b.length && a.every((section, index) => section.text === b[index].text);
}

// Drops the given entries from dev's Unreleased section, then any `### ` heading
// left without entries.
function removeEntries(section, entries) {
  if (entries.length === 0) return section;
  const lines = section.split('\n');
  for (const { start, end } of entries) lines.fill(null, start, end);
  const kept = lines.filter(line => line !== null);
  const result = kept.filter((line, index) => {
    if (!line.startsWith('### ')) return true;
    const next = kept.slice(index + 1).find(candidate => candidate.trim() !== '');
    return next !== undefined && !next.startsWith('### ');
  });
  return result.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/**
 * @param {string} base CHANGELOG.md at the merge base
 * @param {string} ours dev's CHANGELOG.md
 * @param {string} theirs main's CHANGELOG.md
 * @param {string} [merged] git's merge result, if it had no conflict markers
 * @returns {{ text: string } | { reason: string }}
 */
export function mergeChangelog(base, ours, theirs, merged) {
  if (theirs === base) return { text: ours };
  if (ours === base) return { text: theirs };

  const [b, o, t] = [base, ours, theirs].map(parseChangelog);
  if (!b || !o || !t) return { reason: `a version does not start its sections with a single ${UNRELEASED}` };

  if (o.preamble !== b.preamble && t.preamble !== b.preamble && o.preamble !== t.preamble) {
    return { reason: 'both branches changed the text above [Unreleased]' };
  }
  const preamble = t.preamble === b.preamble ? o.preamble : t.preamble;

  const added = t.released.slice(0, t.released.length - b.released.length);
  if (!sameSections(t.released.slice(added.length), b.released)) {
    return { reason: 'main changed or removed an existing release section' };
  }
  const duplicate = added.find(section => o.released.some(existing => existing.heading === section.heading));
  if (duplicate) return { reason: `dev already has ${duplicate.heading}` };
  const released = [...added, ...o.released];

  const baseKeys = new Set(unreleasedEntries(b.unreleased).map(entry => entry.key));
  const theirKeys = new Set(unreleasedEntries(t.unreleased).map(entry => entry.key));
  const ourEntries = unreleasedEntries(o.unreleased);
  const removed = ourEntries.filter(entry => baseKeys.has(entry.key) && !theirKeys.has(entry.key));
  const addedKeys = [...theirKeys].filter(key => !baseKeys.has(key));

  if (addedKeys.length === 0) return { text: render(preamble, removeEntries(o.unreleased, removed), released) };

  const where = 'main has new [Unreleased] entries; fold them into dev by hand';
  if (merged === undefined || CONFLICT_MARKER.test(merged)) return { reason: where };
  const m = parseChangelog(merged);
  const expected = new Set([...ourEntries.filter(entry => !removed.includes(entry)).map(entry => entry.key), ...addedKeys]);
  const got = m ? unreleasedEntries(m.unreleased).map(entry => entry.key) : [];
  const valid = m && m.preamble === preamble && sameSections(m.released, released)
    && got.length === expected.size && got.every(key => expected.has(key));
  return valid ? { text: merged } : { reason: `${where}: git's automatic merge misplaced them` };
}

// CLI, run from a checkout in the middle of merging main into dev (the sync
// workflow, or a person resolving its issue): merges CHANGELOG.md from the merge
// base, HEAD and MERGE_HEAD, replacing git's result, and stages it. Exits 1 with
// the reason and leaves the file as git left it when it cannot.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const show = rev => git('show', `${rev}:CHANGELOG.md`);
  const path = join(git('rev-parse', '--show-toplevel').trim(), 'CHANGELOG.md');
  const outcome = mergeChangelog(
    show(git('merge-base', 'HEAD', 'MERGE_HEAD').trim()),
    show('HEAD'),
    show('MERGE_HEAD'),
    readFileSync(path, 'utf8'),
  );
  if ('reason' in outcome) {
    console.error(`CHANGELOG.md was not merged automatically: ${outcome.reason}.`);
    process.exit(1);
  }
  writeFileSync(path, outcome.text);
  git('add', '--', path);
}
