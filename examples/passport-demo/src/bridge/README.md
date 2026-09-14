# Bridge (sig.network → ACC)

Bringing Ethereum Sepolia USDC into a Passport account, as a shielded token
minted by the sig.network erc20-vault. See
[`docs/bridge/sig-network-integration.md`](../../../../docs/bridge/sig-network-integration.md)
for the design and
[`docs/bridge/sig-network-implementation-plan.md`](../../../../docs/bridge/sig-network-implementation-plan.md)
for the phases.

## What is here (foundation)

- **`managed/`** — the compiled sig.network erc20-vault contract (plus its
  SignetSigner sibling), vendored the way the sig.network reference webapps do,
  because the contract package is Node-oriented. Its **pure** circuits
  (`userCommitment`, `vaultTokenDomainSeparator`) run against the app's existing
  `@midnight-ntwrk/compact-runtime@0.18.0-rc.1` with no ZK artefacts.
- **`contract-exports.ts`** — the single seam the rest of the bridge imports the
  vendored contract through (Contract, pure circuits, witnesses, private state).
- **`config.ts`** — static stagenet identifiers (vault, signet, Sepolia USDC)
  and the env-provided MPC key / Sepolia RPC. The USDC colour comes from
  `src/lib/colour.ts`.
- **`identity.ts`** — derive the vault identity secret from the passkey (its own
  scope), the identity commitment (the vault's `userCommitment` circuit), and the
  Sepolia deposit address (`deriveEvmAddress`). Verified by `identity.test.ts`.

## The claim flow

- **`vaultConstants.ts`** — the version-matched constants the deposit binds (gas
  envelope, transfer selector, output schema, MPC routing, request path).
- **`vaultClient.ts`** — join the deployed vault as a Passport contract and build
  the response reader.
- **`proving.ts`** — the vault's provider set. The claim is a cross-contract call
  (vault → signet), so it fetches both contracts' ZK keys from the hosted bucket
  (vault at the origin root, signet under `/signet`) via a composite ZK-config
  provider, and proves on the configured proof server (`VITE_MIDNIGHT_PROVING_URL`).
- **`mpc.ts`** — the MPC round trip: poll for the signature, broadcast the sweep
  to Sepolia (`ethers`), poll for the attestation.
- **`deposit.ts`** — `runBridgeDeposit`: submit `deposit`, settle via the MPC,
  submit `claim` to mint the bridged-USDC coin into the internal wallet.
- **`depositToAcc.ts`** — `depositBridgedUsdcToAcc` moves the claimed coin into
  the user's ACC via its `deposit_shielded` circuit (fee sponsored), and
  `runBridgeIn` composes the whole flow: deposit → claim → into the ACC.

**Verification**: typechecks (`tsc --noEmit`) and lints clean, and the identity
derivation is unit-tested (`identity.test.ts`). The deposit/claim/MPC round trip
is NOT yet run-verified — it reproduces the sig.network reference webapps against
the vendored 0.19 vault and only proves out against live stagenet + Sepolia + a
proof server. The ZK keys are fetched from the hosted bucket (`VITE_SIGNET_ZK_ORIGIN`,
defaulting to the reference apps' bucket); nothing is staged under `public/zk/`.

## To run it

- **A proof server** (`VITE_MIDNIGHT_PROVING_URL`): the vault claim is a heavy
  cross-contract proof, unlike the in-tab-wasm-proven ACC circuits. The reference
  apps note each user runs their own local proof server.
- **The deposit address funded**: send USDC (and a little Sepolia ETH for gas,
  unless the deployed relayer tops it up) to the derived address before running.

Defaults cover the rest: the MPC network key (`VITE_SIGNET_MPC_PUBKEY`), the ZK
key bucket (`VITE_SIGNET_ZK_ORIGIN`), the responder (`VITE_SIGNET_RESPONSES_URL`),
and the Sepolia RPC (`VITE_SEPOLIA_RPC_URL`) all have working defaults.

In a dev build, `window.__passportBridgeAddress()` returns the deposit address to
fund, and `window.__passportBridgeIn(amount)` runs the whole flow (amount in USDC
base units, e.g. `100000n` = 0.1 USDC).

The claim flow (deposit → MPC attestation → `completeDeposit` → `deposit_shielded`
into the ACC) lands on top of this foundation.
