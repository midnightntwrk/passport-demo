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

## What this needs before the claim flow (next phase)

- **`VITE_SIGNET_MPC_PUBKEY`** — the deployment's compressed secp256k1 MPC public
  key. `config.ts` refuses to resolve without it; the deposit address is wrong
  against any other key. (`VITE_SEPOLIA_RPC_URL` optional, has a public default.)
- **The vault's ZK artefacts** staged under `public/zk/vault/`, matching the
  deployed vault, for the claim proof.
- **A proof server** configured (`VITE_MIDNIGHT_PROVING_URL`): the vault's claim
  is a heavy cross-contract proof, unlike the in-tab-wasm-proven ACC circuits.

The claim flow (deposit → MPC attestation → `completeDeposit` → `deposit_shielded`
into the ACC) lands on top of this foundation.
