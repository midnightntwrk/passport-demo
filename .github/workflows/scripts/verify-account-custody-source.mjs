/**
 * Checks that the tracked `managed/account-custody` build still stands for the
 * upstream contract it claims, by fetching that contract and hashing it.
 *
 * WHAT THIS CATCHES THAT NOTHING ELSE DOES
 * ----------------------------------------
 * The account custody contract is Nicolas's, no copy of it is in this
 * repository, and what IS tracked is the compiler output of one revision of
 * it. That leaves exactly one thing unpoliced: the claim about which revision.
 * `compiler/contract-manifest.json` hashes the OUTPUT files, so it can tell a
 * half-copied build from a whole one and cannot tell which source produced it.
 *
 * So this downloads `contract/contracts/account.compact` at the pinned commit,
 * hashes it, and requires three things to agree:
 *
 *   1. the digest of the downloaded file,
 *   2. `scripts/account-custody-contract.lock.json`,
 *   3. the provenance recorded beside the build — the source hash in
 *      `compiler/contract-manifest.json` if a future compiler ever records
 *      one, and `SOURCE.json`, which `sync-account-custody-contract.mjs`
 *      writes because today's compiler does not.
 *
 * A disagreement is a hard failure. It means the lock is stale, the pin moved,
 * or somebody rebuilt from something other than the pinned source — and the
 * remedy for all three is the sync script, never an edit to the contract.
 *
 * NETWORK. This is the one step here that reaches the internet, to a public
 * raw.githubusercontent.com URL with no credentials. If that is unreachable
 * the step fails loudly rather than passing quietly, because "we could not
 * check" and "it checks out" are different answers.
 *
 *   node .github/workflows/scripts/verify-account-custody-source.mjs
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const lock = JSON.parse(
  readFileSync(path.join(repositoryRoot, 'scripts/account-custody-contract.lock.json'), 'utf8'),
);

const failures = [];
const url = `https://raw.githubusercontent.com/${lock.repository}/${lock.commit}/${lock.path}`;
if (lock.download !== url) {
  failures.push(`the lock's \`download\` (${lock.download}) disagrees with its own commit and path (${url}).`);
}

const response = await fetch(url);
if (!response.ok) {
  console.error(`verify-account-custody-source: ${url} answered ${response.status}.`);
  process.exit(1);
}
const source = Buffer.from(await response.arrayBuffer());
const digest = createHash('sha256').update(source).digest('hex');

if (digest !== lock.sha256) {
  failures.push(
    `${lock.path} at ${lock.commit.slice(0, 7)} hashes ${digest}; the lock says ${lock.sha256}.`,
  );
}
if (source.length !== lock.bytes) {
  failures.push(`${lock.path} is ${source.length} bytes; the lock says ${lock.bytes}.`);
}

/* The provenance recorded beside the build. `SOURCE.json` is what carries it
   today; a `source` section in the manifest is checked too, so that a compiler
   that starts recording one is honoured rather than ignored. */
const buildRoot = path.join(repositoryRoot, lock.output);
const sourceRecordPath = path.join(buildRoot, 'SOURCE.json');
if (!existsSync(sourceRecordPath)) {
  failures.push(
    `${lock.output}/SOURCE.json is missing, so the build records no source. Run ` +
      '`node scripts/sync-account-custody-contract.mjs`.',
  );
} else {
  const record = JSON.parse(readFileSync(sourceRecordPath, 'utf8'));
  if (record.sha256 !== lock.sha256) {
    failures.push(`${lock.output}/SOURCE.json records sha256 ${record.sha256}; the lock says ${lock.sha256}.`);
  }
  if (record.commit !== lock.commit) {
    failures.push(`${lock.output}/SOURCE.json records commit ${record.commit}; the lock says ${lock.commit}.`);
  }
  if (record.repository !== lock.repository || record.path !== lock.path) {
    failures.push(
      `${lock.output}/SOURCE.json points at ${record.repository}:${record.path}, and the lock at ` +
        `${lock.repository}:${lock.path}.`,
    );
  }
}

const manifestPath = path.join(buildRoot, 'compiler/contract-manifest.json');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  /* Today's compiler (0.34.0) records no source hash; this reads one only if
     it is there, so a later compiler that adds the field is checked without
     this script having to be changed to notice. */
  const recorded = manifest.source?.hash ?? manifest['source-hash'];
  if (recorded !== undefined && recorded !== lock.sha256) {
    failures.push(`${lock.output}/compiler/contract-manifest.json records source hash ${recorded}; the lock says ${lock.sha256}.`);
  }
  for (const [field, expected] of [
    ['compiler-version', lock.compiler.version],
    ['language-version', lock.compiler.languageVersion],
    ['runtime-version', lock.compiler.runtimeVersion],
  ]) {
    if (manifest[field] !== expected) {
      failures.push(`the tracked build was compiled with ${field} ${manifest[field]}; the lock pins ${expected}.`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`::error::verify-account-custody-source: ${failure}`);
  console.error(
    '::error::The account custody contract is consumed unchanged from a pinned commit and is never ' +
      'copied or edited here. Re-run `node scripts/sync-account-custody-contract.mjs`, or update the ' +
      'lock deliberately. If the contract itself has to change, that goes to Nicolas.',
  );
  process.exit(1);
}

console.log(
  `verify-account-custody-source: ${lock.repository}:${lock.path} at ${lock.commit.slice(0, 7)} ` +
    `hashes ${digest}, which is what the lock and ${lock.output}/SOURCE.json both say. ` +
    `${source.length} bytes, compiled with ${lock.compiler.invocation}.`,
);
