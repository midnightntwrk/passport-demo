/**
 * Brings the account custody contract onto this machine — as a DOWNLOAD, never
 * as a file in this repository — and compiles it.
 *
 * THE RULE THIS SCRIPT EXISTS TO KEEP (Hector, 2026/09/17)
 * -------------------------------------------------------
 * The account custody contract is Nicolas's. It is never modified, copied,
 * forked, renamed, or versioned here. It is consumed as provided, from
 * `contract/contracts/account.compact` on `midnightntwrk/passport`, at the
 * commit pinned in `scripts/account-custody-contract.lock.json`. Anything that
 * needs the contract itself to change goes to Nicolas.
 *
 * So the source is downloaded into a GITIGNORED directory and the only thing
 * this repository tracks is the COMPILER OUTPUT — `contract/` and `compiler/`
 * under `managed/account-custody`, the same two halves every other build here
 * tracks, with `keys/` and `zkir/` gitignored as they are everywhere else.
 * Build output of an unchanged upstream is not a fork of it, and it is what
 * lets a machine with no compiler serve the module.
 *
 * WHY A HASH AND NOT A HOPE
 * -------------------------
 * A pinned commit on a repository we do not own is still a URL someone else
 * serves. The lock carries the sha256 of the file at that commit, this script
 * refuses to compile anything else, and `.github/workflows/verify-demo.yml`
 * downloads the same URL and checks the same digest on every run — so a lock
 * that has drifted from what upstream serves fails in CI, in seconds, rather
 * than at the first proof on a device.
 *
 * `managed/account-custody/SOURCE.json` records the same commit and digest
 * beside the build, because `compiler/contract-manifest.json` hashes the
 * OUTPUT files and carries nothing about the source they came from.
 *
 * WHAT IT COSTS
 * -------------
 * About three minutes and 3.2 GB, nearly all of it prover keys that stay on
 * this machine, in `prover-keys/` rather than `keys/`: a browser needs the
 * 74 KB of verifier keys and the IR, and proofs for these circuits are made on
 * the proving server, which is where `prover-keys/` is copied to. Neither the Vercel
 * builder nor CI has `compact` on PATH, which is why the output is tracked and
 * this script is a developer's tool rather than a build step.
 *
 *   node scripts/sync-account-custody-contract.mjs
 *   node scripts/sync-account-custody-contract.mjs --check   download and hash
 *                                                            only; compile
 *                                                            nothing.
 *
 *   PASSPORT_ACCOUNT_CUSTODY_SOURCE   a local .compact file to use instead of
 *                                     downloading. Hashed against the lock
 *                                     exactly the same way — this is an
 *                                     offline convenience, not an escape from
 *                                     the check.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(repositoryRoot, 'scripts/account-custody-contract.lock.json');

/**
 * Where the downloaded source lands. GITIGNORED, and named `upstream/` so that
 * the one thing a reader has to know about the directory is in its name.
 */
const UPSTREAM_DIRECTORY = 'examples/passport-balancer/contracts-stagenet/upstream';
/* NAMED AS UPSTREAM NAMES IT, and that is not cosmetic: compactc writes the
   source file name into the generated module's error strings and its source
   map, so a file downloaded under any other name produces a different
   `contract/index.js` for identical circuits. The keys are unaffected — they
   were `cmp` clean across the rename — but the tracked half would churn on a
   detail of ours rather than a change of Nicolas's. The source map's
   `sourceRoot` still records the path this script downloads to, so this
   DIRECTORY is part of the recipe as well: run the script and the build is
   reproduced byte for byte, compile by hand from somewhere else and the map
   and the manifest that hashes it will differ. */
const UPSTREAM_FILE = 'account.compact';

function fail(message) {
  console.error(`sync-account-custody-contract: ${message}`);
  process.exit(1);
}

const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const checkOnly = process.argv.includes('--check');

/** The pinned URL, built from the pinned commit rather than read from the lock. */
const url = `https://raw.githubusercontent.com/${lock.repository}/${lock.commit}/${lock.path}`;
if (lock.download !== url) {
  fail(
    `the lock's \`download\` disagrees with its own commit and path.\n  lock: ${lock.download}\n  pin:  ${url}`,
  );
}

const override = process.env.PASSPORT_ACCOUNT_CUSTODY_SOURCE;
let source;
if (override) {
  if (!existsSync(override)) fail(`PASSPORT_ACCOUNT_CUSTODY_SOURCE is set to ${override}, which is not a file.`);
  source = readFileSync(override);
  console.log(`sync-account-custody-contract: reading ${override} instead of downloading.`);
} else {
  console.log(`sync-account-custody-contract: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    fail(
      `${url} answered ${response.status}. The pinned commit has to be reachable on ${lock.repository}; ` +
        'if it is not, that is a question for Nicolas rather than a reason to keep a copy here.',
    );
  }
  source = Buffer.from(await response.arrayBuffer());
}

/* THE CHECK. A pinned commit is a promise about history; the digest is what
   makes it one we can rely on without owning the repository. */
const digest = createHash('sha256').update(source).digest('hex');
if (digest !== lock.sha256) {
  fail(
    'the account custody contract at the pinned commit is not the file this lock describes.\n' +
      `  expected  ${lock.sha256}\n  got       ${digest}\n` +
      'Nothing was compiled. Either the lock is stale — update it deliberately and re-run — or ' +
      'the pin moved under us, which is a question for Nicolas.',
  );
}
if (source.length !== lock.bytes) {
  fail(`the source is ${source.length} bytes and the lock says ${lock.bytes}.`);
}
console.log(
  `sync-account-custody-contract: sha256 ${digest} matches the lock (${source.length} bytes, ` +
    `${lock.repository}@${lock.commit.slice(0, 7)}).`,
);

const upstreamDirectory = path.join(repositoryRoot, UPSTREAM_DIRECTORY);
mkdirSync(upstreamDirectory, { recursive: true });
const sourcePath = path.join(upstreamDirectory, UPSTREAM_FILE);
writeFileSync(sourcePath, source);
console.log(`sync-account-custody-contract: wrote ${UPSTREAM_DIRECTORY}/${UPSTREAM_FILE} (gitignored).`);

if (checkOnly) {
  console.log('sync-account-custody-contract: --check, compiling nothing.');
  process.exit(0);
}

/* THE COMPILE. `+0.34.0` picks the compiler version rather than whatever the
   developer's default happens to be, and `--feature-zkir-v3` is what makes
   these circuits provable by the v3 proof server and nothing else. Both are in
   the lock, so a build is reproducible from it alone. */
const output = path.join(repositoryRoot, lock.output);
const staging = `${output}.next`;
rmSync(staging, { force: true, recursive: true });
mkdirSync(path.dirname(staging), { recursive: true });

const compile = spawnSync(
  'compact',
  ['compile', `+${lock.compiler.version}`, '--feature-zkir-v3', sourcePath, staging],
  { stdio: 'inherit' },
);
if (compile.error?.code === 'ENOENT') {
  rmSync(staging, { force: true, recursive: true });
  fail(
    'no `compact` on PATH. This is a developer\'s tool: neither the Vercel builder nor CI compiles, ' +
      'which is why the output under `managed/account-custody` is tracked.',
  );
}
if (compile.status !== 0) {
  rmSync(staging, { force: true, recursive: true });
  fail(`\`compact compile\` exited ${compile.status}; nothing was replaced.`);
}

/* WHAT CAME OUT, CHECKED AGAINST WHAT THE LOCK SAYS SHOULD. A compile that
   quietly produced a different runtime version, or a different number of entry
   points, is a build the app would load and fail on at its first prove. */
const manifest = JSON.parse(readFileSync(path.join(staging, 'compiler/contract-manifest.json'), 'utf8'));
for (const [field, expected] of [
  ['compiler-version', lock.compiler.version],
  ['language-version', lock.compiler.languageVersion],
  ['runtime-version', lock.compiler.runtimeVersion],
]) {
  if (manifest[field] !== expected) {
    rmSync(staging, { force: true, recursive: true });
    fail(`the compiler reported ${field} ${manifest[field]}, and the lock pins ${expected}.`);
  }
}

/* THE PROVER KEYS GO TO ONE SIDE, and this is the one place the layout departs
   from what the compiler wrote. `keys/` is the directory every other tool here
   treats as "what a browser is served": `prepare-zk-assets.mjs` filters a
   `.prover` out of it, `tag-release.mjs` refuses to pack one, and
   `verify-zk-artefacts.mjs` fails if one shipped — three rules that a freshly
   compiled tree would break on this machine alone, because compiling is the
   only way to have them.

   So the 3.2 GB of prover keys are moved to `prover-keys/` beside it, which is
   gitignored and is what an operator copies to the proving server, and `keys/`
   is left holding the 74 KB of verifier keys that a browser actually fetches.
   The manifest still lists both, and still hashes both, which is why nothing
   else has to know. */
const compiledKeys = path.join(staging, 'keys');
const proverKeys = path.join(staging, 'prover-keys');
mkdirSync(proverKeys, { recursive: true });
let moved = 0;
for (const name of readdirSync(compiledKeys)) {
  if (!name.endsWith('.prover')) continue;
  renameSync(path.join(compiledKeys, name), path.join(proverKeys, name));
  moved += 1;
}

rmSync(output, { force: true, recursive: true });
spawnSync('mv', [staging, output], { stdio: 'inherit' });

/* THE PROVENANCE, beside the build rather than only in the lock.
   `contract-manifest.json` hashes the output files and says nothing about the
   source, so this is what CI compares the upstream file against. */
writeFileSync(
  path.join(output, 'SOURCE.json'),
  `${JSON.stringify(
    {
      _: [
        'Where this build came from. The contract is NOT ours and no copy of it is in',
        'this repository: it is consumed unchanged from the commit below. Regenerate',
        'with `node scripts/sync-account-custody-contract.mjs`.',
      ],
      repository: lock.repository,
      commit: lock.commit,
      path: lock.path,
      sha256: lock.sha256,
      compiler: lock.compiler.invocation,
    },
    null,
    2,
  )}\n`,
);

console.log(
  `sync-account-custody-contract: ${lock.output} rebuilt from ${lock.repository}@${lock.commit.slice(0, 7)}, ` +
    'unchanged. `contract/` and `compiler/` are tracked; `keys/` and `zkir/` are not.\n' +
    `  ${moved} prover keys moved to prover-keys/ — that directory is the proving server's, not a browser's, ` +
    'and nothing here packs it.',
);
