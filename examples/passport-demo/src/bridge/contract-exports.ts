// The sig.network erc20-vault contract package is TS-only and Node-oriented, so
// — exactly as the sig.network reference webapps do (full-stack-demo,
// Collateral-Warehouse) — we vendor the compiled contract under `./managed` and
// re-declare the small non-compiled pieces here. This is the single seam the
// rest of the bridge imports the contract through.
//
// The vendored `managed/erc20-vault/contract/index.js` pins
// `checkRuntimeVersion('0.18.0-rc.1')`, the same @midnight-ntwrk/compact-runtime
// this app already uses, so its pure circuits (`userCommitment`,
// `vaultTokenDomainSeparator`) run here unchanged. Proving the vault's circuits
// additionally needs its ZK artefacts staged under `public/zk/vault/`, which
// matter for the claim flow, not for the pure derivations this file exposes.

import {
  Contract,
  pureCircuits,
  ledger,
  type Witnesses,
} from './managed/erc20-vault/contract/index.js';

/**
 * Private state carried through vault circuit calls: the caller's 32-byte
 * identity secret. The vault's `callerSecretKey` witness reads it; only its
 * commitment (`userCommitment`) ever reaches the ledger.
 */
export interface VaultPrivateState {
  readonly secretKey: Uint8Array;
}

/** Build the vault's private state from the identity secret. */
export const createVaultPrivateState = (secretKey: Uint8Array): VaultPrivateState => ({
  secretKey,
});

/** The witness the vault contract expects: the identity secret from private state. */
export const witnesses: Witnesses<VaultPrivateState> = {
  callerSecretKey: ({ privateState }: { privateState: VaultPrivateState }): [
    VaultPrivateState,
    Uint8Array,
  ] => [privateState, privateState.secretKey],
};

/** The private-state id the vault is joined under (midnight-js `findDeployedContract`). */
export const VAULT_PRIVATE_STATE_ID = 'erc20-vault';

export { Contract, pureCircuits, ledger };
