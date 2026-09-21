/**
 * Verifies the staged ZK artefacts against the manifests that ARE in git.
 *
 * `examples/passport-balancer/contracts-stagenet/managed/<contract>/` is split
 * down the middle by `.gitignore`: `contract/` and `compiler/` are tracked,
 * `keys/` and `zkir/` are ~97 MB of prover material that is not. CI gets the
 * untracked half from a release asset or the Actions cache, and this script is
 * what makes that safe — `compiler/contract-manifest.json` carries a SHA-256
 * and a byte length for every one of those files, so a bundle from a different
 * build of the same contracts is caught here rather than in a browser.
 *
 * That distinction is the whole risk. Two builds of one contract are two
 * verifier keys, and the contract deployed on stagenet knows only the one it
 * was deployed with; a PWA shipping the other proves circuits that
 * `findDeployedContract` then rejects. `prepare-zk-assets.mjs` makes the same
 * point at length, and refuses to compile anything for the same reason.
 *
 * Recompiling instead of verifying is not an option: the manifests name
 * compiler 0.33.0 (0.33.0-rc.2), and `compact list` offers 0.31.1 then 0.34.0.
 * The compiler that produced what is deployed cannot be installed any more.
 *
 * Exits non-zero, loudly, on the first sign of a missing or altered file.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const MANAGED_ROOT =
  process.env.MANAGED_ROOT ?? 'examples/passport-balancer/contracts-stagenet/managed';

/** The two untracked directories. `contract/` and `compiler/` come from git. */
const DIRECTORIES = ['keys', 'zkir'];
/**
 * Builds that ship VERIFIER keys only. Their prover keys are made and held on
 * the proving server (the account custody build's are 3.2 GB), so a `.prover`
 * entry in the manifest is expected to be absent here — and its presence is a
 * failure,
 * because a bundle that carried it would be gigabytes nobody can serve.
 */
const SERVER_ONLY_PROVER = new Set(['account-custody']);

/**
 * The contracts to check, read off the tree rather than written down.
 *
 * This was `['account', 'midnames']` until 2026/09/15, which is what the bundle
 * happens to carry today — so the list was right by coincidence and would have
 * gone quietly stale the first time a third contract shipped artefacts. A
 * contract is checked when `managed/<name>/` carries a tracked
 * `compiler/contract-manifest.json` AND the bundle actually shipped its
 * artefacts.
 *
 * NOT EVERY MANIFEST NAMES ARTEFACTS THAT SHIP, and that is deliberate rather
 * than an omission. All four builds here — `account`, `account-v1`, `faucet`,
 * `midnames` — carry a manifest with full `keys` and `zkir` sections, but the
 * v16 bundle holds 25 files each for `account` and 23 each for `midnames` and
 * nothing at all under the other two names:
 *
 *   - `account-v1` is MODULE-ONLY. It is the eleven-circuit build every
 *     Passport set up before `transfer_shielded_to_account` is running, and its
 *     keys are byte-identical to the current build's, so the PWA points the v1
 *     module at `/zk/account` and ships one tree. `prepare-zk-assets.mjs` says
 *     the same thing with `assets: false`; asking for artefacts under this name
 *     failed every build that did not happen on the machine that compiled it
 *     (found 2026/09/14).
 *   - `faucet` is the mUSD faucet, which has no caller in the PWA. Checked
 *     2026/09/15: its two circuits are in neither the bundle nor the app.
 *
 * So a contract whose `keys/` and `zkir/` are both absent is skipped and said
 * to be skipped. That is not a hole a bad bundle can hide in: a bundle missing
 * `account/keys` stops at `prepare:zk` — "the account build is incomplete —
 * keys/ is missing" — which is the next step in both workflows and on a
 * builder. A bundle carrying only HALF a contract is refused here, because that
 * is a truncated extraction rather than a build that ships no artefacts.
 */
function contractsToCheck() {
  const names = readdirSync(MANAGED_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const checkable = [];
  for (const name of names) {
    const base = resolve(MANAGED_ROOT, name);
    if (!existsSync(resolve(base, 'compiler', 'contract-manifest.json'))) continue;

    const shipped = DIRECTORIES.filter((directory) => existsSync(resolve(base, directory)));
    if (shipped.length === DIRECTORIES.length) {
      checkable.push(name);
    } else if (shipped.length === 0) {
      console.log(`${name}: no artefacts shipped under this name — skipped.`);
    } else {
      failures.push(
        `partial  ${name}: ${shipped.join(' and ')} present, ${DIRECTORIES.filter(
          (directory) => !shipped.includes(directory),
        ).join(' and ')} missing. A bundle carries both or neither.`,
      );
    }
  }
  return checkable;
}

let checked = 0;
const failures = [];

const CONTRACTS = contractsToCheck();

for (const contract of CONTRACTS) {
  const base = resolve(MANAGED_ROOT, contract);
  const manifestPath = resolve(base, 'compiler', 'contract-manifest.json');

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    failures.push(`${contract}: cannot read ${manifestPath} — ${error.message}`);
    continue;
  }

  for (const directory of DIRECTORIES) {
    const entries = manifest[directory];
    if (!entries) {
      failures.push(`${contract}: the manifest has no ${directory} section.`);
      continue;
    }

    for (const [name, meta] of Object.entries(entries)) {
      // The section carries its own `"type": "directory"` marker alongside the
      // file entries; skip it and anything else that is not a file.
      if (name === 'type' || meta?.type !== 'file') continue;

      const file = resolve(base, directory, name);
      if (directory === 'keys' && name.endsWith('.prover') && SERVER_ONLY_PROVER.has(contract)) {
        if (existsSync(file)) {
          failures.push(
            `shipped  ${contract}/keys/${name}: prover keys for this build stay on the proving server and must not be in the bundle.`,
          );
        }
        continue;
      }
      let bytes;
      try {
        bytes = readFileSync(file);
      } catch {
        failures.push(`missing  ${contract}/${directory}/${name}`);
        continue;
      }

      checked += 1;

      if (bytes.length !== meta.size) {
        failures.push(
          `size     ${contract}/${directory}/${name}: ${bytes.length} bytes, manifest says ${meta.size}`,
        );
        continue;
      }

      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== meta.hash) {
        failures.push(`hash     ${contract}/${directory}/${name}: ${digest} != ${meta.hash}`);
      }
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  console.error('');
  console.error(
    `ZK artefact verification FAILED: ${failures.length} of ${checked + failures.length} files.`,
  );
  console.error(
    'The staged prover keys are not the build these manifests describe, which is the',
  );
  console.error(
    'build deployed on stagenet. Do not ship this — republish the bundle from the tree',
  );
  console.error('the deployment harness produced. See docs/demo/deployment.md.');
  process.exit(1);
}

if (checked === 0) {
  console.error('ZK artefact verification FAILED: no contract under');
  console.error(`${MANAGED_ROOT} shipped artefacts to check. Either the bundle was never`);
  console.error('extracted, or it carries nothing this tree has a manifest for.');
  process.exit(1);
}

console.log(
  `ZK artefacts verified against the committed manifests: ${checked} files across ${CONTRACTS.join(', ')}.`,
);
