// Connect to the deployed sig.network erc20-vault as a Passport contract: the
// vault's compiled module + witnesses + the user's identity secret as private
// state, joined with a cross-contract proof provider (see proving.ts). Plus the
// read helpers the MPC round trip needs.
//
// NOTE: typechecks, but the vault claim's cross-contract proving proves out only
// against a live proof server with the deployed vault's keys hosted at the
// configured ZK origin.

import {
  SignetRequestResponseReader,
  signetEventSourceFromPublicDataProvider,
} from '@sig-net/midnight';

import type { LocalMidnightWallet } from '../lib/localWallet.js';
import type { BridgeConfig } from './config.js';
import { createVaultPrivateState, ledger, VAULT_PRIVATE_STATE_ID } from './contract-exports.js';
import { compiledVault, createVaultProviders } from './proving.js';
import { DEPOSIT_REQUESTS_PATH } from './vaultConstants.js';

/** A connected vault: its providers and the deployed contract's `callTx`. */
export interface VaultConnection {
  readonly providers: {
    readonly publicDataProvider: {
      queryContractState(address: string): Promise<{ data: unknown } | null>;
    };
  } & Record<string, unknown>;
  readonly vault: { callTx: Record<string, (...args: unknown[]) => Promise<unknown>> };
}

/**
 * Join the deployed vault with the caller's identity secret as private state.
 *
 * @param wallet - The internal wallet (pays fees, receives the minted coin).
 * @param config - The bridge configuration.
 * @param secret - The 32-byte vault identity secret (the `callerSecretKey` witness).
 */
export async function connectVault(
  wallet: LocalMidnightWallet,
  config: BridgeConfig,
  secret: Uint8Array,
): Promise<VaultConnection> {
  const initialPrivateState = createVaultPrivateState(secret);
  const [providers, { findDeployedContract }] = await Promise.all([
    createVaultProviders(wallet, config, {
      privateStateId: VAULT_PRIVATE_STATE_ID,
      initialPrivateState,
    }),
    import('@midnight-ntwrk/midnight-js-contracts'),
  ]);
  const vault = await findDeployedContract(providers as never, {
    compiledContract: compiledVault(config) as never,
    contractAddress: config.vaultContractAddress,
    privateStateId: VAULT_PRIVATE_STATE_ID,
    initialPrivateState,
  } as never);
  return { providers, vault } as unknown as VaultConnection;
}

/** Read and decode the vault's ledger state (request nonce, pinned chain config, …). */
export async function readVaultLedger(
  connection: VaultConnection,
  config: BridgeConfig,
): Promise<Record<string, unknown>> {
  const cs = await connection.providers.publicDataProvider.queryContractState(
    config.vaultContractAddress,
  );
  if (!cs) throw new Error(`no vault contract state at ${config.vaultContractAddress}`);
  return (ledger as (data: unknown) => Record<string, unknown>)(cs.data);
}

/** A request/response reader over the vault↔signet pair, reading the deposit request map. */
export function makeResponseReader(
  connection: VaultConnection,
  config: BridgeConfig,
  requestsPath: readonly number[] = DEPOSIT_REQUESTS_PATH,
): SignetRequestResponseReader {
  return new SignetRequestResponseReader({
    requesterContractAddress: config.vaultContractAddress,
    requesterRequestsPath: [...requestsPath],
    signetContractAddress: config.signetContractAddress,
    publicDataProvider: connection.providers.publicDataProvider as never,
    eventSource: signetEventSourceFromPublicDataProvider(
      connection.providers.publicDataProvider as never,
    ),
  });
}
