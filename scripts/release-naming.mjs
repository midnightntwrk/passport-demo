/**
 * How a Passport release is named.
 *
 * WHY THIS EXISTS (2026/09/07)
 * ----------------------------
 * The first naming scheme tagged every deploy `demo-YYYY.MM.DD-<build id>` and
 * marked it a PRE-release. Both parts were wrong for the one person the rule is
 * for. A pre-release never shows as "Latest" on the repository's front page, so
 * a reviewer looking at midnightntwrk/passport-demo saw a three-day-old release
 * and reasonably concluded nothing had shipped since. And a tag carrying a date
 * and a build id answers "which build is this?" but not "which release is
 * this?" — there is no way to say "we are on release four" in a sentence.
 *
 * So the tag became `v<N>`, counting up from the releases that already existed,
 * titled `v<N> - YYYY/MM/DD`. The date stays, because a release number with no
 * date is a fact nobody can place. The build id and the commit move into the
 * body, where they are still checkable against a running client.
 *
 * WHAT CHANGED (2026/09/15)
 * -------------------------
 * A flat count says which release is live and nothing else. Sixteen of them
 * went by without the reviewer ever being able to tell, from the number alone,
 * whether v14 had added something or repaired something. So the number now
 * carries that:
 *
 *   - the next release is **v1.0** — the count starts again, deliberately;
 *   - a patch or a bug fix moves the DECIMAL: v1.0 → v1.1 → v1.2;
 *   - a new feature moves the WHOLE NUMBER, and the decimal resets: v1.2 → v2.0.
 *
 * Tags are `v<major>.<minor>` and titles `v<major>.<minor> - YYYY/MM/DD`.
 *
 * The old undotted `v1`–`v16` stay exactly where they are — they are history,
 * and the builds they carry are still downloadable — but they take no part in
 * deriving the next number. That is what makes the next release v1.0 rather
 * than v17.0: `releaseVersionOf` reads `^v(\d+)\.(\d+)$` and nothing else, so
 * a legacy tag is simply not a candidate.
 *
 * They do still decide ONE thing: which release the notes delta is taken
 * against. With no dotted release yet, the release before v1.0 is v16, so
 * v1.0's body is what has changed since v16 rather than the whole cumulative
 * file. See `previousReleaseTag`.
 *
 * Everything here is pure, so `scripts/release-naming.test.mjs` can hold the
 * derivation and the title to their contract without touching a network.
 */

/** The kinds of change a release can carry, and which part of the number moves. */
export const RELEASE_KINDS = ['fix', 'feature'];

/**
 * Strip a candidate down to the name it carries.
 *
 * Accepts what both sources of truth actually print:
 *   - `git ls-remote --tags`:  `refs/tags/v1.0`, and its `refs/tags/v1.0^{}` peel
 *   - `gh release list`:       the tag `v1.0`, and the title `v1.0 - 2026/09/15`
 */
function bareName(candidate) {
  if (typeof candidate !== 'string') {
    return null;
  }
  return candidate
    .trim()
    .replace(/^[0-9a-f]{40}\s+/, '') // a full `git ls-remote` line, sha and all
    .replace(/^refs\/tags\//, '')
    .replace(/\^\{\}$/, '');
}

/**
 * The `{ major, minor }` a tag or release title carries, or `null` for a name
 * that is not one of ours.
 *
 * ONLY the dotted shape counts. A legacy `v16`, and a `demo-2026.09.04-…` tag
 * older still, both answer `null` — which is what starts the count at v1.0 on a
 * repository that has only those.
 */
export function releaseVersionOf(candidate) {
  const name = bareName(candidate);
  if (name === null) {
    return null;
  }
  const match = /^v(\d+)\.(\d+)(?:\s|$)/.exec(name);
  if (!match) {
    return null;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || major < 1 || minor < 0) {
    return null;
  }
  return { major, minor };
}

/**
 * The number a LEGACY `v<N>` tag carries — v1 to v16 — or `null`. Used for one
 * thing only: finding the release that v1.0's notes delta is taken against.
 * It never contributes to the next number.
 */
export function legacyReleaseNumberOf(candidate) {
  const name = bareName(candidate);
  if (name === null) {
    return null;
  }
  const match = /^v(\d+)(?:\s|$)/.exec(name);
  if (!match) {
    return null;
  }
  const number = Number(match[1]);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** Negative when `a` is the earlier release, positive when it is the later one. */
export function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor;
}

/**
 * The highest `v<major>.<minor>` among the given tags and titles, or `null`
 * when there is none.
 */
export function highestReleaseVersion(candidates) {
  return (candidates ?? []).reduce((highest, candidate) => {
    const version = releaseVersionOf(candidate);
    if (version === null) {
      return highest;
    }
    return highest === null || compareVersions(version, highest) > 0 ? version : highest;
  }, null);
}

/** The highest legacy `v<N>`; 0 when there is none. */
export function highestLegacyReleaseNumber(candidates) {
  return (candidates ?? []).reduce((highest, candidate) => {
    if (releaseVersionOf(candidate) !== null) {
      return highest; // a dotted tag is not a legacy one
    }
    const number = legacyReleaseNumberOf(candidate);
    return number !== null && number > highest ? number : highest;
  }, 0);
}

/**
 * The version the next release takes.
 *
 * With no dotted release yet, the first one is **v1.0**, whatever legacy tags
 * the repository holds. After that, `kind` decides which part moves: a `fix`
 * takes the decimal up one, a `feature` takes the whole number up one and
 * resets the decimal to 0.
 */
export function nextReleaseVersion(candidates, kind = 'fix') {
  assertKind(kind);
  const highest = highestReleaseVersion(candidates);
  if (highest === null) {
    return { major: 1, minor: 0 };
  }
  return kind === 'feature'
    ? { major: highest.major + 1, minor: 0 }
    : { major: highest.major, minor: highest.minor + 1 };
}

/** `v1.0`. */
export function releaseTag(version) {
  assertVersion(version);
  return `v${version.major}.${version.minor}`;
}

/** `v1.0 - 2026/09/15`. */
export function releaseTitle(version, date) {
  assertVersion(version);
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(date ?? '')) {
    throw new TypeError(`release date must be YYYY/MM/DD, got ${JSON.stringify(date)}`);
  }
  return `${releaseTag(version)} - ${date}`;
}

/**
 * Today in UTC as `YYYY/MM/DD`, so two people in two timezones tagging the same
 * deploy agree.
 */
export function releaseDate(now = new Date()) {
  return now.toISOString().slice(0, 10).replaceAll('-', '/');
}

/**
 * The "## Fixed" section of RELEASE-NOTES.md — the heading and everything under
 * it. The file opens with a line of instructions to whoever writes it next,
 * which belongs in the repository and not in a release body.
 *
 * Returns '' when there is no such section; the caller decides whether that is
 * fatal (it is, for a real release).
 */
export function fixedSection(notes) {
  const match = /^##\s*Fixed\s*$/im.exec(notes ?? '');
  return match ? notes.slice(match.index).trim() : '';
}

/**
 * WHAT A RELEASE BODY SAYS (2026/09/08)
 * -------------------------------------
 * RELEASE-NOTES.md is CUMULATIVE: every "## Fixed" entry written since
 * 2026/09/03 is still in it, because it is the changelog. Its header line used
 * to tell whoever wrote it next to rewrite the file before every deploy, and
 * nobody ever did — so publishing the whole section made v10 on GitHub a
 * 51,000-character page listing forty-two fixes, the same text v1 to v8 had
 * carried. A reviewer opening it cannot tell what THIS deploy changed, which
 * is the only question a release page exists to answer.
 *
 * So the file stays cumulative and the release page carries the DELTA: the
 * entries whose bold title was not already there at the previous release, one
 * line each. The full prose stays in the repository, where whoever wants it
 * will look for it.
 */

/** How long one entry's summary sentence may run before it is trimmed. */
export const SUMMARY_SENTENCE_LIMIT = 220;

/**
 * How long the whole body may run. A release over this means someone deployed
 * far too much at once — the interesting failure, not a formatting problem —
 * so it is refused rather than truncated, and the operator can insist with
 * `--allow-long`.
 */
export const RELEASE_BODY_LIMIT = 4000;

/* A sentence end is a full stop followed by whitespace, so neither `0.1.1` nor
   `` `.night` `` splits one. These are the remaining cases where that rule
   would end a sentence too early. */
const ABBREVIATIONS = ['e.g.', 'i.e.', 'etc.', 'vs.', 'mr.', 'mrs.', 'ms.', 'dr.'];

/**
 * The entries of the "## Fixed" section, as `{ title, detail }`.
 *
 * An entry opens with `- **Title**` at the start of a line and runs until the
 * next one (or the next heading); its indented continuation paragraphs are
 * folded into `detail`, so a summary can be taken from the whole of it.
 */
export function fixedEntries(notes) {
  const section = fixedSection(notes);
  if (!section) {
    return [];
  }
  const entries = [];
  let current = null;
  for (const line of section.split('\n').slice(1)) {
    const opening = /^-\s+\*\*(.+?)\*\*\s*(.*)$/.exec(line);
    if (opening) {
      current = { title: opening[1].trim(), detail: [opening[2].trim()].filter(Boolean) };
      entries.push(current);
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      current = null;
      continue;
    }
    if (current && line.trim()) {
      current.detail.push(line.trim());
    }
  }
  return entries.map(({ title, detail }) => ({ title, detail: detail.join(' ') }));
}

/**
 * The entries in `notes` that were not already in `previousNotes`, matched on
 * the bold title. A title is what a human would recognise as "the same fix";
 * the prose under it is edited between deploys and the commits are not in the
 * file at all, so neither can be the identity.
 */
export function newEntries(notes, previousNotes) {
  const previous = new Set(fixedEntries(previousNotes).map((entry) => entry.title));
  return fixedEntries(notes).filter((entry) => !previous.has(entry.title));
}

/**
 * One entry as one line: `- **Title.** First sentence of the entry.`
 *
 * The "(found by the release gate, 2026/09/08)" parenthetical every entry
 * opens with is dropped — it is provenance for the changelog, not news for the
 * release page — and the sentence is capped, so one very long sentence cannot
 * push the body over its limit by itself.
 */
export function summariseEntry(entry, limit = SUMMARY_SENTENCE_LIMIT) {
  const title = String(entry?.title ?? '').trim().replace(/[.\s]+$/, '');
  const detail = String(entry?.detail ?? '').replace(/^\s*\([^()]*\)\s*[.,;:]?\s*/, '');
  const sentence = capSentence(firstSentence(detail), limit);
  return sentence ? `- **${title}.** ${sentence}` : `- **${title}.**`;
}

/**
 * The body of a release: the header line, then this release's delta.
 *
 * Throws a `RangeError` when the result is over `bodyLimit` and `allowLong` is
 * not set, because a body that long is a deploy that should have been two.
 */
export function releaseBody({
  buildId,
  commit,
  productionUrl = 'https://midnightpassport.com',
  entries = [],
  gateSummary,
  sentenceLimit = SUMMARY_SENTENCE_LIMIT,
  bodyLimit = RELEASE_BODY_LIMIT,
  allowLong = false,
} = {}) {
  const header =
    `Build ${String(buildId ?? '').slice(0, 8)} · ` +
    `commit ${String(commit ?? '').slice(0, 7)} · ${productionUrl}`;
  const delta = entries.length
    ? ['## Fixed in this release', ...entries.map((entry) => summariseEntry(entry, sentenceLimit))]
    : ['## This release', '- Release tooling only; no user-facing change.'];
  const body = [
    header,
    '',
    ...delta,
    ...(gateSummary ? ['', 'Gates', '-----', gateSummary] : []),
  ].join('\n');
  if (!allowLong && body.length > bodyLimit) {
    throw new RangeError(
      `the release body is ${body.length} characters, over the ${bodyLimit}-character limit ` +
        `(${entries.length} new ${entries.length === 1 ? 'entry' : 'entries'}). That is more than ` +
        "one deploy's worth of change: deploy less at a time, or pass --allow-long to publish it anyway.",
    );
  }
  return body;
}

/**
 * The TAG of the release before `version` — the one whose RELEASE-NOTES.md the
 * delta is taken against — or `null` when there is none.
 *
 * The highest dotted release below `version` wins. When there is no dotted
 * release below it (which is the case for v1.0, the first of the new scheme),
 * the highest LEGACY `v<N>` stands in, so v1.0's body is what has changed since
 * v16 rather than the entire cumulative file. Legacy tags are ignored for
 * everything else, including deriving the next number.
 */
export function previousReleaseTag(candidates, version) {
  assertVersion(version);
  const below = (candidates ?? []).reduce((highest, candidate) => {
    const other = releaseVersionOf(candidate);
    if (other === null || compareVersions(other, version) >= 0) {
      return highest;
    }
    return highest === null || compareVersions(other, highest) > 0 ? other : highest;
  }, null);
  if (below !== null) {
    return releaseTag(below);
  }
  const legacy = highestLegacyReleaseNumber(candidates);
  return legacy > 0 ? `v${legacy}` : null;
}

function firstSentence(text) {
  const ends = /[.!?](?=\s|$)/g;
  let match;
  while ((match = ends.exec(text)) !== null) {
    const head = text.slice(0, match.index + 1);
    const lowered = head.toLowerCase();
    if (ABBREVIATIONS.some((abbreviation) => lowered.endsWith(abbreviation))) {
      continue;
    }
    return head.trim();
  }
  return text.trim();
}

function capSentence(sentence, limit) {
  if (sentence.length <= limit) {
    return sentence;
  }
  const cut = sentence.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed.replace(/[\s,;:.]+$/, '')}…`;
}

function assertVersion(version) {
  const major = version?.major;
  const minor = version?.minor;
  if (!Number.isSafeInteger(major) || major < 1 || !Number.isSafeInteger(minor) || minor < 0) {
    throw new TypeError(
      `a release version is { major >= 1, minor >= 0 }, got ${JSON.stringify(version)}`,
    );
  }
}

function assertKind(kind) {
  if (!RELEASE_KINDS.includes(kind)) {
    throw new TypeError(
      `a release is a ${RELEASE_KINDS.join(' or a ')}, got ${JSON.stringify(kind)}. ` +
        'A fix moves the decimal; a feature moves the whole number.',
    );
  }
}
