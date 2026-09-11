// The user's sig.network vault identity, and the Sepolia address they fund.
//
// The claim runs from Passport's internal wallet, but the vault binds a caller
// to a 32-byte identity SECRET (its `callerSecretKey` witness), and the Sepolia
// deposit address is that secret's commitment run through the MPC key. We derive
// the secret from the passkey in its OWN scope, so it is cryptographically
// separated from the wallet seed, the Midnames owner key, and the account-
// contract root, and is re-derivable on any device holding the passkey.
//
// Nothing here persists a secret: derive it inside a one-shot passkey gesture,
// use it, and let the caller zero it — the same discipline the rest of the app
// keeps for passkey-derived secrets.

import { deriveEvmAddress } from '@sig-net/midnight';

import type { BridgeConfig } from './config.js';
import {
  createVaultPrivateState,
  pureCircuits,
  type VaultPrivateState,
} from './contract-exports.js';

/** The passkey derivation-scope account id for the vault identity. */
export const SIGNET_VAULT_ACCOUNT_ID = 'signet-vault-v1';

/** A passkey derivation scope, as the app's seed provider expects. */
export interface SignetVaultScope {
  readonly appId: string;
  readonly accountId: string;
}

/** The vault identity's derivation scope for a given app id (e.g. `org.midnight.passport.demo`). */
export function signetVaultScope(appId: string): SignetVaultScope {
  return { appId, accountId: SIGNET_VAULT_ACCOUNT_ID };
}

/**
 * Derive the 32-byte vault identity secret from the passkey.
 *
 * Decoupled from the concrete seed provider: the caller passes the app's
 * `deriveWalletSeed` (a one-shot passkey handle), so this stays unit-testable.
 *
 * @param deriveSeed - The app's scoped-seed deriver (returns exactly 32 bytes).
 * @param appId - The app id the other passkey scopes use.
 */
export async function deriveSignetVaultSecret(
  deriveSeed: (scope: SignetVaultScope) => Promise<Uint8Array>,
  appId: string,
): Promise<Uint8Array> {
  return deriveSeed(signetVaultScope(appId));
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * The identity commitment the vault stores and the MPC uses as the derivation
 * path. Computed by the vault's own `userCommitment` circuit — never a
 * re-implementation — so the client and the contract cannot disagree.
 */
export function signetIdentityCommitmentHex(secret: Uint8Array): string {
  return toHex(pureCircuits.userCommitment(secret));
}

/**
 * The Sepolia address the user sends USDC to. `deriveEvmAddress` binds the
 * deployment's MPC key, the vault, and the identity commitment; the default
 * chain id matches the sig.network deployment.
 */
export function signetDepositAddress(secret: Uint8Array, config: BridgeConfig): string {
  return deriveEvmAddress(
    config.mpcSecp256k1Pubkey,
    config.vaultContractAddress,
    signetIdentityCommitmentHex(secret),
  );
}

/** The vault private state (the `callerSecretKey` witness) for a claim. */
export function signetVaultPrivateState(secret: Uint8Array): VaultPrivateState {
  return createVaultPrivateState(secret);
}
