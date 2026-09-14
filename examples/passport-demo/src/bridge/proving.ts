// Proving the vault's transactions. The vault claim is a CROSS-CONTRACT call
// (the vault calls the signet contract), so proving it needs both contracts'
// ZK keys — and those keys are large, hosted on object storage rather than
// staged locally. The sig.network reference apps fetch the vault keys from the
// bucket root and the signet keys from `<origin>/signet`; we do the same, and
// resolve a circuit's key from whichever bucket has it.
//
// NOTE: cross-contract proving details are version-specific. This typechecks and
// follows the reference apps' shape, but only proves out against a live proof
// server with the deployed vault's keys hosted at the configured origin.

import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { ZKConfigProvider } from '@midnight-ntwrk/midnight-js-types';

import {
  inMemoryPrivateStateProvider,
  sharedPublicDataProvider,
  walletProviderFor,
} from '../identity/contractRuntime.js';
import type { LocalMidnightWallet } from '../lib/localWallet.js';
import type { BridgeConfig } from './config.js';
import { Contract, type VaultPrivateState, witnesses } from './contract-exports.js';

/** Cross-contract proves are slow: give them a generous ceiling. */
const PROOF_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Resolve each circuit's keys from the first of several sources that has it, so
 * the vault claim finds vault keys at the bucket root and signet keys under
 * `/signet`. `getVerifierKeys` and `get` come from the base class, built on the
 * three primitives overridden here.
 */
class CompositeZkConfigProvider extends ZKConfigProvider<string> {
  constructor(private readonly sources: readonly ZKConfigProvider<string>[]) {
    super();
  }

  private async first<T>(fetchOne: (source: ZKConfigProvider<string>) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (const source of this.sources) {
      try {
        return await fetchOne(source);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('no ZK config source resolved the circuit');
  }

  getZKIR(circuitId: string) {
    return this.first((source) => source.getZKIR(circuitId));
  }

  getProverKey(circuitId: string) {
    return this.first((source) => source.getProverKey(circuitId));
  }

  getVerifierKey(circuitId: string) {
    return this.first((source) => source.getVerifierKey(circuitId));
  }
}

/** Build the vault's compiled contract, fetching its ZK assets from the hosted origin. */
export function compiledVault(config: BridgeConfig): unknown {
  return CompiledContract.make('signet-vault', Contract as never).pipe(
    CompiledContract.withWitnesses(witnesses as never),
    CompiledContract.withCompiledFileAssets(config.zkOrigin),
  );
}

/** Options for {@link createVaultProviders}. */
export interface VaultProviderOptions {
  readonly privateStateId: string;
  readonly initialPrivateState: VaultPrivateState;
}

/**
 * The provider set for the vault: Passport's own wallet / public-data / private-
 * state providers, with a cross-contract proof provider whose keys come from the
 * hosted bucket (vault at the root, signet under `/signet`) and prove on the
 * configured proof server.
 *
 * @throws {Error} If no proof server is configured (the vault circuits are too
 *   large to prove in-tab).
 */
export async function createVaultProviders(
  wallet: LocalMidnightWallet,
  config: BridgeConfig,
  options: VaultProviderOptions,
) {
  const zkOptions = { fetchFunc: globalThis.fetch.bind(globalThis) };
  const vaultZk = new FetchZkConfigProvider<string>(config.zkOrigin, zkOptions);
  const signetZk = new FetchZkConfigProvider<string>(`${config.zkOrigin}/signet`, zkOptions);
  const zkConfigProvider = new CompositeZkConfigProvider([vaultZk, signetZk]);

  const provers = wallet.network.provingServerUrls;
  if (provers.length === 0) {
    throw new Error(
      'the vault claim needs a proof server: set VITE_MIDNIGHT_PROVING_URL — the ' +
        'vault circuits are too large to prove in-tab.',
    );
  }
  const { httpClientProofProvider } = await import(
    '@midnight-ntwrk/midnight-js-http-client-proof-provider'
  );
  const proofProvider = httpClientProofProvider({
    url: provers[0],
    zkConfigProvider: zkConfigProvider,
    timeout: PROOF_TIMEOUT_MS,
  });

  const walletProvider = walletProviderFor(wallet);
  return {
    privateStateProvider: inMemoryPrivateStateProvider({
      [options.privateStateId]: options.initialPrivateState,
    }),
    publicDataProvider: await sharedPublicDataProvider(
      wallet.network.indexerHttpUrl,
      wallet.network.indexerWsUrl,
    ),
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider: walletProvider,
  };
}
