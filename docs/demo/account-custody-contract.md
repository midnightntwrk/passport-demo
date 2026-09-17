# The account custody contract

*2026/09/17.*

## The rule

**The account custody contract is never modified, copied, forked, renamed, or
versioned in this repository.** It is Nicolas's. It lives at
`contract/contracts/account.compact` on `midnightntwrk/passport` `main`, and it
is consumed here exactly as provided.

A verbatim copy under another filename is a fork. So is a local edit, however
small, and so is keeping "our version" of it beside theirs. **Any blocker — a
circuit that is missing, a signature that will not verify, a change the demo
needs — goes to Nicolas.** It is never worked around here.

## What the demo runs today

The deployed Passport account contract is **the prototype**, and it always has
been. It is
`examples/passport-balancer/contracts-stagenet/src/account_custody.compact`,
compiled into `managed/account`:

- **Twelve circuits:** `add_device`, `add_grant`, `deposit_night`,
  `deposit_shielded`, `grant_withdraw_night`, `grant_withdraw_shielded`,
  `recover`, `remove_device`, `revoke_grant`, `transfer_shielded_to_account`,
  `withdraw_night`, `withdraw_shielded`.
- **No signature verification of any kind.** A device authorises a call by
  proving knowledge of a 32-byte secret behind a hash commitment — a
  hash-preimage witness. The word `secp256k1` does not occur in that source
  file, and neither does any other curve.
- Every Passport in existence is one of these, and the eleven-circuit build
  before it (`managed/account-v1`, no `transfer_shielded_to_account`) is the
  same contract at an earlier revision.

That is the state of the demo, stated as a fact rather than as a plan. Nothing
in this change alters it: no flow names the custody build, `accountModuleFor`
returns it only for an account already deployed from it, and no such account
exists.

## What the account custody contract is

Nicolas's contract is a different contract, not a newer revision of ours:

- **Thirty provable circuits**, whose names do not intersect the prototype's
  twelve at all.
- **Two arms of the same size**, `_with_jubjub` and `_with_k256`, over every
  gated operation — device management, grants, withdrawals, the inbox. That is
  what lets one account be held by a phone's passkey and a secp256k1 key at
  the same time.
- The k256 arm verifies with **`secp256k1EcdsaVerify`** inside the circuit.
- **ZKIR v3** (`compact compile +0.34.0 --feature-zkir-v3`), language 0.26.0,
  runtime 0.19.0. Neither the in-tab prover (`@midnight-ntwrk/zkir-v2`) nor the
  1AM stagenet gateway (`ledger9-zkir2-dispatch`) can prove those circuits, so
  the demo reads a separate proof-server list, `VITE_MIDNIGHT_PROVING_URL_V3`,
  for that module only, and an empty list there is a refusal rather than a
  fallback.

Its proofs are verified by stagenet: two transactions on 2026/09/16, made with
`midnightntwrk/proof-server:9.0.0-rc.6`.

## How it is consumed

No copy of the source is here. The tracked build is compiler **output** of one
pinned revision of it.

| | |
|---|---|
| `scripts/account-custody-contract.lock.json` | repository, commit, path, sha256, byte length, compiler invocation |
| `scripts/sync-account-custody-contract.mjs` | downloads that revision, checks the digest, compiles it |
| `examples/passport-balancer/contracts-stagenet/upstream/` | where the download lands — **gitignored** |
| `…/contracts-stagenet/managed/account-custody/` | the build: `contract/` and `compiler/` tracked, `keys/` and `zkir/` gitignored, as for every other build here |
| `…/managed/account-custody/prover-keys/` | the 3.2 GB of prover keys, moved out of `keys/` by the sync script and gitignored. This is what an operator copies to the proving server; nothing packs it |
| `…/managed/account-custody/SOURCE.json` | the commit and digest the build stands for |
| `.github/workflows/scripts/verify-account-custody-source.mjs` | fetches the pinned source on every CI run and requires the lock, the digest, and `SOURCE.json` to agree |

```sh
node scripts/sync-account-custody-contract.mjs          # download, check, compile (~3 min)
node scripts/sync-account-custody-contract.mjs --check   # download and check only
```

Moving to a newer upstream revision is an edit to the lock and a re-run of the
script. It is never an edit to the downloaded file, which the script overwrites
anyway.

**Why the output is tracked and the source is not.** Neither the Vercel builder
nor CI has `compact` on `PATH`, so a machine that cannot compile still has to
be able to serve the module and type-check against it. Build output of an
unchanged upstream is not a fork of that upstream; a second copy of the source
would be.

## How a Dynamic Passport is created, and why nothing migrates

A Dynamic account is created **on Nicolas's contract, unchanged**, with the
Dynamic key as its device. It is a new account, deployed from that build on
first sign-in, with the k256 arm doing the authorising — which is what that arm
is for.

**There is no migration.** Existing Passports stay on the prototype contract,
at the address they already have, with the passkey device they already have,
and they are opened with the module they were deployed from — the choice
`accountModuleFor` makes by reading the deployed contract's own entry points.
Nobody is drained, re-deployed, re-pointed, or re-funded. The two kinds of
account coexist because the app picks the module per account rather than per
build.

The demo's prover keys for the custody build are 3.2 GB and stay on the proving
server; a browser needs only the 74 KB of verifier keys and the IR, both of
which a release bundle can carry.

## Prover keys, and what a browser gets

| | prover keys | verifier keys | IR |
|---|---|---|---|
| directory | `prover-keys/` | `keys/` | `zkir/` |
| where it goes | the proving server | the release bundle | the release bundle |
| size | 3.2 GB | 74,286 bytes | 818,411 bytes |

`keys/` holds verifier keys only because the sync script moves the prover keys
to `prover-keys/` as its last step. That keeps `keys/` meaning the same thing
for this build as for every other one — what a browser is served — so a tree
that has just been compiled passes the same gates as a tree that was
downloaded.

`tag-release.mjs` refuses to pack a `.prover` for this build,
`prepare-zk-assets.mjs` leaves one behind, and `verify-zk-artefacts.mjs` fails
if one shipped. See [deployment.md](./deployment.md).
