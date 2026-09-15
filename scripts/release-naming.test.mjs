/**
 * The naming contract for a Passport release.
 *
 * Run with `npm run test:release-naming` (or `node --test scripts/`).
 *
 * The scheme (Hector, 2026/09/15): the next release is v1.0; a fix moves the
 * decimal (v1.1, v1.2, …); a feature moves the whole number and resets the
 * decimal (v2.0). The legacy undotted `v1`–`v16` stay as history and take no
 * part in the count — which is the case that matters most here, because it is
 * the only reason the next release is v1.0 and not v17.0.
 *
 * The one thing the legacy tags still decide is which release the notes delta
 * is taken against: with no dotted release yet, the release before v1.0 is v16,
 * so v1.0's body is what changed since v16 rather than the whole cumulative
 * file.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RELEASE_BODY_LIMIT,
  compareVersions,
  fixedEntries,
  fixedSection,
  highestLegacyReleaseNumber,
  highestReleaseVersion,
  legacyReleaseNumberOf,
  newEntries,
  nextReleaseVersion,
  previousReleaseTag,
  releaseBody,
  releaseDate,
  releaseTag,
  releaseTitle,
  releaseVersionOf,
  summariseEntry,
} from './release-naming.mjs';

test('a version is read from every shape the two sources print', () => {
  assert.deepEqual(releaseVersionOf('v1.0'), { major: 1, minor: 0 });
  assert.deepEqual(releaseVersionOf('refs/tags/v1.2'), { major: 1, minor: 2 });
  assert.deepEqual(releaseVersionOf('refs/tags/v2.0^{}'), { major: 2, minor: 0 });
  assert.deepEqual(releaseVersionOf('v1.0 - 2026/09/15'), { major: 1, minor: 0 });
  assert.deepEqual(
    releaseVersionOf('0123456789abcdef0123456789abcdef01234567\trefs/tags/v3.11'),
    { major: 3, minor: 11 },
  );
});

test('a name that is not a dotted release carries no version', () => {
  // The legacy scheme, which is history and nothing more.
  assert.equal(releaseVersionOf('v16'), null);
  assert.equal(releaseVersionOf('refs/tags/v16'), null);
  assert.equal(releaseVersionOf('v16 - 2026/09/15'), null);
  // The scheme before that.
  assert.equal(releaseVersionOf('demo-2026.09.04-19729c64'), null);
  assert.equal(releaseVersionOf('refs/tags/demo-2026.09.07-a207dee8'), null);
  // Not ours at all.
  assert.equal(releaseVersionOf('v1.2.3'), null);
  assert.equal(releaseVersionOf('vercel-output'), null);
  assert.equal(releaseVersionOf('v0.1'), null);
  assert.equal(releaseVersionOf(undefined), null);
});

test('THE FIRST RELEASE OF THE NEW SCHEME IS v1.0, legacy tags and all', () => {
  // The repository as it actually stands on 2026/09/15: v1 to v16 undotted,
  // the demo- tags older still, and not one dotted release.
  const existing = [
    'refs/tags/demo-2026.09.04-19729c64',
    ...Array.from({ length: 16 }, (_, index) => `refs/tags/v${index + 1}`),
    'v16 - 2026/09/15',
  ];
  assert.equal(highestReleaseVersion(existing), null);
  assert.equal(releaseTag(nextReleaseVersion(existing)), 'v1.0');
  assert.equal(releaseTag(nextReleaseVersion(existing, 'feature')), 'v1.0');
  // And on a repository with nothing at all.
  assert.equal(releaseTag(nextReleaseVersion([])), 'v1.0');
  assert.equal(releaseTag(nextReleaseVersion(undefined)), 'v1.0');
});

test('a fix moves the decimal', () => {
  assert.equal(releaseTag(nextReleaseVersion(['refs/tags/v1.0'], 'fix')), 'v1.1');
  assert.equal(releaseTag(nextReleaseVersion(['refs/tags/v1.1', 'v1.0 - 2026/09/15'])), 'v1.2');
  // A fix is what you get without saying which kind it is.
  assert.equal(releaseTag(nextReleaseVersion(['v2.4'])), 'v2.5');
});

test('a feature moves the whole number and resets the decimal', () => {
  assert.equal(releaseTag(nextReleaseVersion(['refs/tags/v1.0'], 'feature')), 'v2.0');
  assert.equal(releaseTag(nextReleaseVersion(['refs/tags/v1.7'], 'feature')), 'v2.0');
  assert.equal(releaseTag(nextReleaseVersion(['v2.0', 'refs/tags/v1.7'], 'feature')), 'v3.0');
});

test('a release is a fix or a feature, and nothing else', () => {
  assert.throws(() => nextReleaseVersion(['v1.0'], 'patch'), TypeError);
  assert.throws(() => nextReleaseVersion(['v1.0'], ''), TypeError);
});

test('the legacy tags are ignored when the dotted ones exist too', () => {
  const existing = ['refs/tags/v16', 'refs/tags/v1.0', 'refs/tags/v1.1', 'v1.1 - 2026/09/16'];
  assert.deepEqual(highestReleaseVersion(existing), { major: 1, minor: 1 });
  assert.equal(releaseTag(nextReleaseVersion(existing, 'fix')), 'v1.2');
  assert.equal(releaseTag(nextReleaseVersion(existing, 'feature')), 'v2.0');
  // v16 is a bigger integer than 1 and still loses, because it is not a release
  // under this scheme.
  assert.equal(legacyReleaseNumberOf('v16'), 16);
  assert.equal(highestLegacyReleaseNumber(existing), 16);
});

test('the count is numeric, not alphabetical', () => {
  assert.equal(releaseTag(nextReleaseVersion(['v1.9', 'v1.10'])), 'v1.11');
  assert.equal(releaseTag(nextReleaseVersion(['v9.0', 'v10.0'], 'feature')), 'v11.0');
  assert.ok(compareVersions({ major: 1, minor: 10 }, { major: 1, minor: 9 }) > 0);
  assert.ok(compareVersions({ major: 1, minor: 10 }, { major: 2, minor: 0 }) < 0);
});

test('the tag is v<major>.<minor> and the title is v<major>.<minor> - YYYY/MM/DD', () => {
  assert.equal(releaseTag({ major: 1, minor: 0 }), 'v1.0');
  assert.equal(releaseTitle({ major: 1, minor: 0 }, '2026/09/15'), 'v1.0 - 2026/09/15');
  assert.equal(releaseTitle({ major: 12, minor: 3 }, '2026/10/01'), 'v12.3 - 2026/10/01');
});

test('a title refuses a date in any other shape, and a version in any other shape', () => {
  assert.throws(() => releaseTitle({ major: 1, minor: 0 }, '2026-09-15'), TypeError);
  assert.throws(() => releaseTitle({ major: 1, minor: 0 }, '15/09/2026'), TypeError);
  assert.throws(() => releaseTitle({ major: 0, minor: 1 }, '2026/09/15'), TypeError);
  assert.throws(() => releaseTag({ major: 1 }), TypeError);
  assert.throws(() => releaseTag(1), TypeError);
});

test('the date is UTC, formatted the way this repository writes dates', () => {
  assert.equal(releaseDate(new Date('2026-09-15T23:30:00Z')), '2026/09/15');
  // Late evening in New York is already the next day in UTC, and the tag is UTC.
  assert.equal(releaseDate(new Date('2026-09-07T04:00:00Z')), '2026/09/07');
});

test('the body carries the Fixed section, not the note to whoever writes it', () => {
  const notes = [
    'Build notes for the NEXT production deploy. Rewrite this file before every deploy.',
    '',
    '## Fixed',
    '- **Something was broken** (found 2026/09/07).',
    '',
  ].join('\n');
  assert.equal(fixedSection(notes), '## Fixed\n- **Something was broken** (found 2026/09/07).');
  assert.equal(fixedSection('no section here'), '');
});

/* The delta. RELEASE-NOTES.md is cumulative, so these two fixtures are what the
   file looked like at the previous release and what it looks like now — the
   shape that made v10 publish forty-two fixes when four had shipped. */

const previousFile = [
  'Build notes. This file is cumulative.',
  '',
  '## Fixed',
  '- **An old fix that shipped a while ago** (found by the release gate, 2026/09/05). It was broken. Then it was not.',
  '',
  '  A second paragraph nobody needs on the release page.',
  '',
  '- **Another old one** (reported 2026/09/06). Something else was wrong.',
  '',
].join('\n');

const currentFile = [
  'Build notes. This file is cumulative.',
  '',
  '## Fixed',
  '- **A brand new fix** (found in production, 2026/09/08). The sponsor was ahead of the record. It said so, loudly, and two people were told a send had failed.',
  '',
  '  A continuation paragraph, which is part of the same entry.',
  '- **An old fix that shipped a while ago** (found by the release gate, 2026/09/05). It was broken. Then it was not.',
  '',
  '  A second paragraph nobody needs on the release page.',
  '',
  '- **A second new fix** (seen against production, 2026/09/08). Shipped as `@midnight-passport/connect` 0.1.1, and the name is a `.night` name. Not this sentence.',
  '- **Another old one** (reported 2026/09/06). Something else was wrong.',
  '',
].join('\n');

test('an entry is its bold title plus the prose under it, continuations and all', () => {
  const entries = fixedEntries(currentFile);
  assert.equal(entries.length, 4);
  assert.equal(entries[0].title, 'A brand new fix');
  assert.match(entries[0].detail, /^\(found in production, 2026\/09\/08\)\./);
  assert.match(entries[0].detail, /A continuation paragraph, which is part of the same entry\.$/);
  assert.deepEqual(fixedEntries('no Fixed section here'), []);
});

test('the delta is the entries whose title was not there at the previous release', () => {
  assert.deepEqual(
    newEntries(currentFile, previousFile).map((entry) => entry.title),
    ['A brand new fix', 'A second new fix'],
  );
  // Nothing new since the previous release: the same file, deployed twice.
  assert.deepEqual(newEntries(currentFile, currentFile), []);
  // No previous release at all: every entry is new.
  assert.equal(newEntries(currentFile, '').length, 4);
});

test('an entry summarises to one line, without its provenance parenthetical', () => {
  const [first, second] = newEntries(currentFile, previousFile);
  assert.equal(
    summariseEntry(first),
    '- **A brand new fix.** The sponsor was ahead of the record.',
  );
  // A full stop inside `0.1.1` or `.night` does not end the sentence.
  assert.equal(
    summariseEntry(second),
    '- **A second new fix.** Shipped as `@midnight-passport/connect` 0.1.1, and the name is a `.night` name.',
  );
});

test('a long first sentence is cut at a word, not mid-word', () => {
  const entry = { title: 'A long one', detail: `(found 2026/09/08). ${'word '.repeat(80)}end.` };
  const line = summariseEntry(entry, 60);
  const sentence = line.slice('- **A long one.** '.length);
  assert.ok(sentence.length <= 60, `sentence was ${sentence.length} characters`);
  assert.ok(sentence.endsWith('…'));
  assert.ok(!sentence.includes('wor…'));
  // Under the limit, the sentence is left exactly as written.
  assert.equal(summariseEntry(entry, 5000).endsWith('end.'), true);
});

test('the body is the header line and this release delta, nothing else', () => {
  const body = releaseBody({
    buildId: '42acea841f96624d',
    commit: '9477b2e7ae7c1cbc7d170c701b36e76c0e07ce13',
    entries: newEntries(currentFile, previousFile),
  });
  assert.equal(
    body.split('\n')[0],
    'Build 42acea84 · commit 9477b2e · https://midnightpassport.com',
  );
  assert.match(body, /^## Fixed in this release$/m);
  assert.equal(body.split('\n').filter((line) => line.startsWith('- **')).length, 2);
  assert.ok(!body.includes('An old fix that shipped a while ago'));
});

test('a release with no new entries says so rather than repeating the last one', () => {
  const body = releaseBody({
    buildId: '42acea841f96624d',
    commit: '9477b2e7ae7c1cbc7d170c701b36e76c0e07ce13',
    entries: newEntries(currentFile, currentFile),
  });
  assert.equal(
    body,
    [
      'Build 42acea84 · commit 9477b2e · https://midnightpassport.com',
      '',
      '## This release',
      '- Release tooling only; no user-facing change.',
    ].join('\n'),
  );
});

test('a body over 4,000 characters is refused, and --allow-long overrides it', () => {
  const entries = Array.from({ length: 40 }, (_, index) => ({
    title: `Fix number ${index} with a title long enough to matter`,
    detail: `(found 2026/09/08). ${'a clause that runs on and on, '.repeat(12)}and then it ends.`,
  }));
  assert.equal(RELEASE_BODY_LIMIT, 4000);
  assert.throws(
    () => releaseBody({ buildId: '42acea84', commit: '9477b2e', entries }),
    (error) => error instanceof RangeError && /over the 4000-character limit/.test(error.message),
  );
  const forced = releaseBody({ buildId: '42acea84', commit: '9477b2e', entries, allowLong: true });
  assert.ok(forced.length > RELEASE_BODY_LIMIT);
});

test('the previous release is the highest dotted one below the one being created', () => {
  // v1.2 was never published, so the release before v1.3 is v1.1.
  const existing = ['refs/tags/v1.0', 'refs/tags/v1.1', 'refs/tags/v1.3', 'v1.3 - 2026/09/20'];
  assert.equal(previousReleaseTag(existing, { major: 1, minor: 3 }), 'v1.1');
  assert.equal(previousReleaseTag(existing, { major: 2, minor: 0 }), 'v1.3');
  assert.equal(previousReleaseTag(existing, { major: 1, minor: 1 }), 'v1.0');
});

test('WITH NO DOTTED RELEASE YET, THE PREVIOUS RELEASE IS THE HIGHEST LEGACY TAG', () => {
  // This is what makes v1.0's body the delta since v16 rather than the whole
  // cumulative RELEASE-NOTES.md.
  const existing = [
    'refs/tags/demo-2026.09.04-19729c64',
    'refs/tags/v15',
    'refs/tags/v16',
    'v16 - 2026/09/15',
  ];
  assert.equal(previousReleaseTag(existing, { major: 1, minor: 0 }), 'v16');
  // Once a dotted release exists, the legacy tags stop standing in.
  assert.equal(previousReleaseTag([...existing, 'refs/tags/v1.0'], { major: 1, minor: 1 }), 'v1.0');
  // A repository with no releases of either scheme has nothing to delta against.
  assert.equal(previousReleaseTag(['refs/tags/demo-2026.09.04-19729c64'], { major: 1, minor: 0 }), null);
  assert.equal(previousReleaseTag([], { major: 1, minor: 0 }), null);
});
