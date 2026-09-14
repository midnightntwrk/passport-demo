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
- **`vaultClient.ts`** — join the deployed vault as a Passport contract (reusing
  the account contract's provider/join path) and build the response reader.
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
proof server, with the vault ZK artefacts staged.

## What this needs before the claim flow (next phase)

- **The vault's ZK artefacts** staged under `public/zk/vault/`, matching the
  deployed vault, for the claim proof.
- **A proof server** configured (`VITE_MIDNIGHT_PROVING_URL`): the vault's claim
  is a heavy cross-contract proof, unlike the in-tab-wasm-proven ACC circuits.
  (The sig.network reference apps note each user runs their own local proof
  server, as the vault circuits are too large to share.)

The MPC network key defaults to the stagenet key in `config.ts` (override with
`VITE_SIGNET_MPC_PUBKEY`); `VITE_SEPOLIA_RPC_URL` has a public default.

The claim flow (deposit → MPC attestation → `completeDeposit` → `deposit_shielded`
into the ACC) lands on top of this foundation.
