import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { mergeChangelog } from './merge-changelog.mjs';

// Real CHANGELOG.md versions from past `main` → `dev` syncs: merge base, dev (ours)
// and main (theirs) of the named merge commit, cut above `## [2.0.1]` and with
// long entries shortened. `expected.md` is the maintainer's resolution unless noted.
function fixture(name) {
  const read = file => readFileSync(new URL(`../test/fixtures/changelog-sync/${name}/${file}.md`, import.meta.url), 'utf8');
  return { read, versions: ['base', 'ours', 'theirs'].map(read) };
}

const CONFLICTED = '<<<<<<< HEAD\n- dev\n=======\n- main\n>>>>>>> origin/main\n';

const changelog = (unreleased, ...releases) =>
  ['# Changelog', ['## [Unreleased]', ...unreleased].join('\n\n'), ...releases].join('\n\n') + '\n';
const RELEASE_1 = '## [1.0.0] - 2026-01-01\n\n### Added\n\n- First release.';
const RELEASE_2 = '## [1.0.1] - 2026-02-01\n\n### Fixed\n\n- A fix.';

test('2.0.7 (merge 64b3452): inserts the release below dev\'s Unreleased whatever git produced', () => {
  const { read, versions } = fixture('release-2.0.7');
  const expected = read('expected');
  // CI's plain merge conflicts; with mergiraf the merge is clean but files dev's
  // 2.1 entries under [2.0.7]. Both are rebuilt the same way.
  assert.deepEqual(mergeChangelog(...versions, CONFLICTED), { text: expected });
  assert.deepEqual(mergeChangelog(...versions, read('mergiraf')), { text: expected });
  // The resolution in 64b3452 also kept main's released Telegram fix in dev's
  // Unreleased; it is now listed only under [2.0.7], as in the 2.0.3 sync below.
  assert.match(read('ours').split('## [2.0.6]')[0], /several posts with videos/);
  assert.doesNotMatch(expected.split('## [2.0.7]')[0], /several posts with videos/);
  assert.match(expected.split('## [2.0.7]')[1].split('## [2.0.6]')[0], /several posts with videos/);
});

test('2.0.3 (merge f7908e6): matches the maintainer, dropping the entry main released from dev\'s Unreleased', () => {
  const { read, versions } = fixture('release-2.0.3');
  assert.deepEqual(mergeChangelog(...versions, CONFLICTED), { text: read('expected') });
});

test('2.0.4 and 2.0.5 in one sync (merge ada9c9d): inserts both releases in main\'s order', () => {
  const { read, versions } = fixture('releases-2.0.4-2.0.5');
  assert.deepEqual(mergeChangelog(...versions, CONFLICTED), { text: read('expected') });
});

test('a pending fix on main (merge 28efcf0) is left to a person unless git placed it correctly', () => {
  const { read, versions } = fixture('main-fix-pending');
  assert.match(mergeChangelog(...versions, CONFLICTED).reason, /new \[Unreleased\] entries; fold them into dev by hand$/);
  assert.match(mergeChangelog(...versions).reason, /by hand$/);

  // The maintainer filed main's fix under dev's ### Fixed; a clean merge with that
  // outcome is kept as it is.
  const maintainer = read('maintainer');
  assert.deepEqual(mergeChangelog(...versions, maintainer), { text: maintainer });

  const fix = maintainer.match(/^- Theater mode now fills the window.*\n/m)[0];
  const misfiled = maintainer.replace(fix, '').replace('### Added\n\n', `### Added\n\n${fix}`);
  assert.match(mergeChangelog(...versions, misfiled).reason, /misplaced them$/);
  const dropped = maintainer.replace(fix, '');
  assert.match(mergeChangelog(...versions, dropped).reason, /misplaced them$/);
  const underRelease = maintainer.replace('## [Unreleased]\n\n', '## [Unreleased]\n\n## [2.0.7] - 2026-10-26\n\n');
  assert.match(mergeChangelog(...versions, underRelease).reason, /misplaced them$/);
});

test('a side that left the changelog alone takes the other side\'s file', () => {
  const base = changelog([], RELEASE_1);
  const changed = changelog(['### Added\n\n- New.'], RELEASE_1);
  assert.deepEqual(mergeChangelog(base, changed, base, CONFLICTED), { text: changed });
  assert.deepEqual(mergeChangelog(base, base, changed, CONFLICTED), { text: changed });

  // Neither shortcut lets a malformed changelog through to dev.
  const malformed = '# Changelog\n\n' + RELEASE_1 + '\n\n## [Unreleased]\n';
  assert.match(mergeChangelog(base, malformed, base).reason, /single ## \[Unreleased\]/);
  assert.match(mergeChangelog(base, base, malformed).reason, /single ## \[Unreleased\]/);
});

test('entries dev reworded or moved stay in dev\'s Unreleased after main releases them', () => {
  const base = changelog(['### Fixed\n\n- A fix.'], RELEASE_1);
  const ours = changelog(['### Added\n\n- Feature.', '### Fixed\n\n- A fix, reworded.'], RELEASE_1);
  const theirs = changelog([], RELEASE_2, RELEASE_1);
  assert.deepEqual(mergeChangelog(base, ours, theirs), { text: changelog(['### Added\n\n- Feature.', '### Fixed\n\n- A fix, reworded.'], RELEASE_2, RELEASE_1) });
});

test('anything beyond prepended releases falls back to a person', () => {
  const base = changelog([], RELEASE_1);
  const ours = changelog(['### Added\n\n- Feature.'], RELEASE_1);
  const reason = theirs => mergeChangelog(base, ours, theirs).reason;

  assert.match(reason(changelog([], RELEASE_2, RELEASE_1.replace('First', 'Initial'))), /changed or removed an existing release section/);
  assert.match(reason(changelog([], RELEASE_2)), /changed or removed an existing release section/);
  assert.match(reason('# Changelog\n\n' + RELEASE_2 + '\n'), /single ## \[Unreleased\]/);
  assert.match(mergeChangelog(base, changelog([], RELEASE_2, RELEASE_1), changelog([], RELEASE_2, RELEASE_1).replace('Fixed', 'Changed')).reason, /dev already has ## \[1\.0\.1\]/);
  assert.match(
    mergeChangelog(base, ours.replace('# Changelog', '# Changes'), changelog([], RELEASE_2, RELEASE_1).replace('# Changelog', '# History')).reason,
    /both branches changed the text above/,
  );
});
